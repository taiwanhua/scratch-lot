import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import { LOTTERY_SETTINGS_PERMISSIONS as P } from "@repo/domain/project/lottery-settings";

import { OperatorContextService } from "../../../auth/operator-context.service";
import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../../auth/test-support/fixtures";
import type { OperatorContext } from "../../../database/operator-context";
import { countDbCommands } from "../../../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { PASSWORD, login } from "../../../fields/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_GAMES_COLLECTION } from "../../database/lottery-games/lottery-game.schema";
import { LOTTERY_BOOKS_COLLECTION } from "../../database/lottery-inventory/lottery-book.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import {
  LOTTERY_SETTINGS_COLLECTION,
  LotterySetting,
} from "../../database/lottery-settings/lottery-setting.schema";
import {
  LOTTERY_STORE_COUNT_MODES_COLLECTION,
  LotteryStoreCountMode,
} from "../../database/lottery-settings/lottery-store-count-mode.schema";
import { StoreCountModeService } from "./store-count-mode.service";

// ---- GraphQL ----

const SETTING_VALUE = /* GraphQL */ `
  fragment TestSettingValue on LotterySettingValue {
    option
    source
    sourceOrgName
  }
`;

const SETTINGS_FIELDS = /* GraphQL */ `
  orgId
  orgName
  isTenantTop
  isStore
  canEdit
  items {
    key
    options
    effective { ...TestSettingValue }
    parent { ...TestSettingValue }
  }
  storeCountMode { mode since lastRenumberAt canCancelConversion }
`;

const SETTINGS = /* GraphQL */ `
  query Settings($input: LotterySettingsInput) {
    lotterySettings(input: $input) { ${SETTINGS_FIELDS} }
  }
  ${SETTING_VALUE}
`;

const CUSTOMIZE = /* GraphQL */ `
  mutation Customize($input: CustomizeLotterySettingInput!) {
    customizeLotterySetting(input: $input) { settings { ${SETTINGS_FIELDS} } }
  }
  ${SETTING_VALUE}
`;

const RESTORE = /* GraphQL */ `
  mutation Restore($input: RestoreLotterySettingInput!) {
    restoreLotterySetting(input: $input) { settings { ${SETTINGS_FIELDS} } }
  }
  ${SETTING_VALUE}
`;

const CANCEL_CONVERSION = /* GraphQL */ `
  mutation Cancel($input: CancelLotteryCountModeConversionInput!) {
    cancelLotteryCountModeConversion(input: $input) {
      settings { ${SETTINGS_FIELDS} }
    }
  }
  ${SETTING_VALUE}
`;

const CHECK = /* GraphQL */ `
  query Check($input: LotteryCountModeChangeCheckInput!) {
    lotteryCountModeChangeCheck(input: $input) {
      stores {
        orgId
        orgName
        from
        to
        problems
      }
      pendingSkipBooks {
        orgName
        cashPointName
        gameCode
        gameName
        bookNo
        pendingCount
      }
      busyStores {
        orgName
        stocktake
        rescan
        renumber
      }
      canSave
    }
  }
`;

const HISTORY = /* GraphQL */ `
  query History($input: LotteryStoreCountModeHistoryInput!) {
    lotteryStoreCountModeHistory(input: $input) {
      orgName
      items {
        from
        to
        at
        byName
        cause
        stocktakeId
      }
    }
  }
`;

// ---- 型別 ----

interface SettingValue {
  option: string;
  source: string;
  sourceOrgName: string | null;
}

interface SettingsPayload {
  orgId: string;
  orgName: string;
  isTenantTop: boolean;
  isStore: boolean;
  canEdit: boolean;
  items: {
    key: string;
    options: string[];
    effective: SettingValue;
    parent: SettingValue | null;
  }[];
  storeCountMode: {
    mode: string;
    since: string | null;
    lastRenumberAt: string | null;
    canCancelConversion: boolean;
  } | null;
}

interface CheckPayload {
  stores: {
    orgId: string;
    orgName: string;
    from: string;
    to: string;
    problems: string[];
  }[];
  pendingSkipBooks: {
    orgName: string;
    cashPointName: string;
    gameCode: string;
    gameName: string;
    bookNo: string;
    pendingCount: number;
  }[];
  busyStores: {
    orgName: string;
    stocktake: boolean;
    rescan: boolean;
    renumber: boolean;
  }[];
  canSave: boolean;
}

interface HistoryPayload {
  orgName: string;
  items: {
    from: string | null;
    to: string;
    at: string;
    byName: string | null;
    cause: string;
    stocktakeId: string | null;
  }[];
}

interface Person {
  userId: Types.ObjectId;
  token: string;
}

const base = () => {
  const now = new Date();
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
};

/** 每個端點回的資料形狀(測試只取用到的欄位)。 */
interface Payloads {
  lotterySettings: SettingsPayload;
  customizeLotterySetting: { settings: SettingsPayload };
  restoreLotterySetting: { settings: SettingsPayload };
  cancelLotteryCountModeConversion: { settings: SettingsPayload };
  lotteryCountModeChangeCheck: CheckPayload;
  lotteryStoreCountModeHistory: HistoryPayload;
}

function dataOf<Key extends keyof Payloads>(
  result: GraphqlResult,
  key: Key,
): Payloads[Key] {
  expect(result.errors).toBeUndefined();
  const value = result.data?.[key];
  if (value === undefined || value === null) {
    throw new Error(`${key} 沒有回資料`);
  }
  return value as Payloads[Key];
}

function extensionsOf(result: GraphqlResult): Record<string, unknown> {
  expect(result.errors).toBeDefined();
  return result.errors?.[0]?.extensions ?? {};
}

function itemOf(payload: SettingsPayload, key: string) {
  const found = payload.items.find((item) => item.key === key);
  if (!found) {
    throw new Error(`設定頁沒有 ${key}`);
  }
  return found;
}

/**
 * 刮刮樂設定(張數店規格第 4 節、5.5、5.6、9.1、9.2;驗收 16.2):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─ 好運彩券行(可見性 包含下層)─┬─ 北區 ─┬─ 中山店
 *                                              │         └─ 民生店
 *                                              └─ 新竹店
 */
describe("刮刮樂設定(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let north: Types.ObjectId;
  let zhongshan: Types.ObjectId;
  let minsheng: Types.ObjectId;
  let hsinchu: Types.ObjectId;
  let pointMinsheng: Types.ObjectId;
  let game: Types.ObjectId;

  /** 總部:全部權限 */
  let hq: Person;
  /** 總部只有 view + edit-org(不能改最上層組織的預設) */
  let orgEditor: Person;
  /** 中山店店長:只有 view */
  let manager: Person;
  /** 中山店:這個模組沒有任何權限 */
  let outsider: Person;

  let accountSequence = 0;

  async function personOf(
    orgId: Types.ObjectId,
    permissionKeys: string[],
    name: string,
  ): Promise<Person> {
    accountSequence += 1;
    const account = `lottery-settings-${String(accountSequence)}`;
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds: [orgId],
    });
    await connection
      .collection("users")
      .updateOne({ _id: userId }, { $set: { name } });
    await createRole(api.app, connection, {
      name: `刮刮樂設定角色:${account}`,
      ownerOrgId: orgId,
      moduleKeys: ["lottery-settings"],
      permissionKeys,
      assignTo: [userId],
    });
    return { userId, token: await login(api, account) };
  }

  async function operatorOf(
    who: Person,
    orgId: Types.ObjectId,
  ): Promise<OperatorContext> {
    const resolved = await api.app
      .get(OperatorContextService)
      .resolve(who.userId, orgId);
    return resolved.operator;
  }

  function gql(
    who: Person,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: who.token });
  }

  async function settingsOf(
    who: Person,
    orgId?: Types.ObjectId,
  ): Promise<SettingsPayload> {
    return dataOf(
      await gql(who, SETTINGS, {
        input: orgId === undefined ? null : { orgId: String(orgId) },
      }),
      "lotterySettings",
    );
  }

  function customize(
    who: Person,
    orgId: Types.ObjectId,
    key: string,
    option: string,
  ): Promise<GraphqlResult> {
    return gql(who, CUSTOMIZE, {
      input: { orgId: String(orgId), key, option },
    });
  }

  function restore(
    who: Person,
    orgId: Types.ObjectId,
    key: string,
  ): Promise<GraphqlResult> {
    return gql(who, RESTORE, { input: { orgId: String(orgId), key } });
  }

  async function check(
    who: Person,
    orgId: Types.ObjectId,
    option: string | null,
  ): Promise<CheckPayload> {
    return dataOf(
      await gql(who, CHECK, { input: { orgId: String(orgId), option } }),
      "lotteryCountModeChangeCheck",
    );
  }

  async function historyOf(
    who: Person,
    orgId: Types.ObjectId,
  ): Promise<HistoryPayload> {
    return dataOf(
      await gql(who, HISTORY, { input: { orgId: String(orgId) } }),
      "lotteryStoreCountModeHistory",
    );
  }

  async function modeDocOf(orgId: Types.ObjectId) {
    return connection
      .collection<LotteryStoreCountMode>(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .findOne({ orgId });
  }

  async function modeOf(orgId: Types.ObjectId): Promise<string> {
    const doc = await modeDocOf(orgId);
    return doc?.mode ?? "numbered";
  }

  /** 每個情境前把設定與分店實際制度清空(各情境互不影響)。 */
  async function resetWorld() {
    await connection.collection(LOTTERY_SETTINGS_COLLECTION).deleteMany({});
    await connection
      .collection(LOTTERY_STORE_COUNT_MODES_COLLECTION)
      .deleteMany({});
    await connection.collection(LOTTERY_TICKETS_COLLECTION).deleteMany({});
    await connection.collection(LOTTERY_BOOKS_COLLECTION).deleteMany({});
  }

  let ticketSequence = 0;

  /** 一張未對號的已售張(張數店依張數賣挑到的)。 */
  async function insertUnmatchedTicket(orgId: Types.ObjectId) {
    ticketSequence += 1;
    const ticketNo = String(ticketSequence).padStart(3, "0");
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertOne({
      orgId,
      tenantId: tenant,
      moduleKey: "inventory",
      bookId: new Types.ObjectId(),
      gameId: game,
      bookNo: "0099999",
      ticketNo,
      ticketKey: `5201-0099999-${ticketNo}-${String(orgId)}`,
      status: "sold",
      location: { kind: "counter", cashPointId: null },
      lockedBy: null,
      responsibleOrgId: null,
      unitCost: 20,
      soldAt: new Date(),
      soldBy: null,
      soldSource: "count",
      unmatched: true,
      saleEventId: null,
      version: 2,
      ...base(),
    });
  }

  /** 民生店的收銀點上有一本待標註 2 張的本(迄號 102、標準 100、還沒標跳號;拆過、有張在檯面上)。 */
  async function insertPendingSkipBook() {
    const bookId = new Types.ObjectId();
    await connection.collection(LOTTERY_BOOKS_COLLECTION).insertOne({
      _id: bookId,
      orgId: minsheng,
      tenantId: tenant,
      moduleKey: "inventory",
      shareOrgs: [],
      gameId: game,
      gameCode: "5201",
      bookNo: "0060116",
      bookKey: "5201-0060116",
      printVersion: "1",
      holderOrgIds: [minsheng],
      rate: 100,
      cost: 2000,
      standardTickets: 100,
      firstTicketNo: "001",
      lastTicketNo: "102",
      skippedTicketNos: [],
      lockedTicketCount: 0,
      ticketCounts: {
        stock: 0,
        counter: 102,
        inTransit: 0,
        sold: 0,
        scrapped: 0,
        investigating: 0,
        lost: 0,
        unmatchedSold: 0,
        unmatchedInvestigating: 0,
      },
      firstOpenedAt: new Date(),
      status: "normal",
      ...base(),
    });
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertOne({
      orgId: minsheng,
      tenantId: tenant,
      moduleKey: "inventory",
      bookId,
      gameId: game,
      bookNo: "0060116",
      ticketNo: "001",
      ticketKey: "5201-0060116-001",
      status: "unsold",
      location: { kind: "counter", cashPointId: pointMinsheng },
      lockedBy: null,
      responsibleOrgId: null,
      unitCost: 20,
      soldAt: null,
      soldBy: null,
      soldSource: null,
      unmatched: false,
      saleEventId: null,
      version: 2,
      ...base(),
    });
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-settings");
    connection = api.connection;
    await api.app
      .get<Model<LotterySetting>>(getModelToken(LotterySetting.name))
      .init();
    await api.app
      .get<Model<LotteryStoreCountMode>>(
        getModelToken(LotteryStoreCountMode.name),
      )
      .init();

    const { insertedId: moduleId } = await connection
      .collection("modules")
      .insertOne({
        key: "lottery-settings",
        name: "刮刮樂設定",
        parentId: null,
        ancestors: [],
        route: "lottery-settings",
        sidebarType: "link",
        order: 75,
        enabled: true,
        isSystem: false,
        icon: null,
        settings: {},
        engine: "fixed",
        ...base(),
      });
    await connection.collection("permissions").insertMany(
      Object.values(P).map((key) => ({
        key,
        moduleId,
        name: key,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...base(),
      })),
    );

    tenant = await createOrg(connection, {
      name: "好運彩券行",
      settings: { visibility: "subtree" },
    });
    north = await createOrg(connection, { name: "北區", parentId: tenant });
    zhongshan = await createOrg(connection, {
      name: "中山店",
      parentId: north,
    });
    minsheng = await createOrg(connection, {
      name: "民生店",
      parentId: north,
    });
    hsinchu = await createOrg(connection, { name: "新竹店", parentId: tenant });

    ({ insertedId: game } = await connection
      .collection(LOTTERY_GAMES_COLLECTION)
      .insertOne({
        orgId: tenant,
        tenantId: tenant,
        moduleKey: "master-data",
        gameCode: "5201",
        name: "金好運",
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 100,
        color: null,
        status: "on_sale",
        launchedAt: null,
        ...base(),
      }));
    ({ insertedId: pointMinsheng } = await connection
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
        orgId: minsheng,
        tenantId: tenant,
        positionKey: "position-1",
        name: "店內櫃台",
        order: 1,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
        ...base(),
      }));

    hq = await personOf(tenant, Object.values(P), "何家華");
    orgEditor = await personOf(tenant, [P.view, P.editOrg], "王小明");
    manager = await personOf(zhongshan, [P.view], "中山店長");
    outsider = await personOf(zhongshan, [], "路人");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("SET1 沿組織樹繼承、[自訂] / [還原]、店長只能看、稽核", () => {
    beforeAll(resetWorld);

    it("沒有任何自訂:四條設定都是程式預設", async () => {
      const page = await settingsOf(hq, zhongshan);
      expect(page).toMatchObject({
        orgName: "中山店",
        isTenantTop: false,
        isStore: true,
        canEdit: true,
        storeCountMode: { mode: "numbered", canCancelConversion: false },
      });
      expect(
        page.items.map((item) => [
          item.key,
          item.effective.option,
          item.effective.source,
        ]),
      ).toEqual([
        ["count_mode", "numbered", "default"],
        ["renumber_required", "remind", "default"],
        ["renumber_reminder", "monthly", "default"],
        ["transfer_grid_pick", "on", "default"],
      ]);
      const top = await settingsOf(hq, tenant);
      expect(top).toMatchObject({
        isTenantTop: true,
        isStore: false,
        storeCountMode: null,
      });
    });

    it("最上層組織 [自訂] → 分店沿用;分店再 [自訂] → 本店自訂、附上層值;[還原] → 回到沿用", async () => {
      dataOf(
        await customize(hq, tenant, "renumber_reminder", "weekly"),
        "customizeLotterySetting",
      );
      expect(
        itemOf(await settingsOf(manager), "renumber_reminder").effective,
      ).toEqual({
        option: "weekly",
        source: "inherited",
        // 店長看不到最上層組織:不露出名稱
        sourceOrgName: null,
      });
      expect(
        itemOf(await settingsOf(hq, zhongshan), "renumber_reminder").effective,
      ).toEqual({
        option: "weekly",
        source: "inherited",
        sourceOrgName: "好運彩券行",
      });

      const own = dataOf(
        await customize(hq, zhongshan, "renumber_reminder", "none"),
        "customizeLotterySetting",
      ).settings;
      expect(itemOf(own, "renumber_reminder")).toMatchObject({
        effective: { option: "none", source: "own" },
        parent: { option: "weekly", source: "inherited" },
      });

      const restored = dataOf(
        await restore(hq, zhongshan, "renumber_reminder"),
        "restoreLotterySetting",
      ).settings;
      expect(itemOf(restored, "renumber_reminder")).toMatchObject({
        effective: { option: "weekly", source: "inherited" },
        parent: null,
      });

      // [還原] = 軟刪除
      const rows = await connection
        .collection(LOTTERY_SETTINGS_COLLECTION)
        .find({ orgId: zhongshan, key: "renumber_reminder" })
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deletedAt).not.toBeNull();
    });

    it("區域的自訂蓋過最上層組織:分店 → 區域 → 最上層組織", async () => {
      await customize(hq, north, "renumber_reminder", "biweekly");
      expect(
        itemOf(await settingsOf(hq, minsheng), "renumber_reminder").effective,
      ).toEqual({
        option: "biweekly",
        source: "inherited",
        sourceOrgName: "北區",
      });
      expect(
        itemOf(await settingsOf(hq, hsinchu), "renumber_reminder").effective
          .option,
      ).toBe("weekly");
      // 服務端讀分店的生效值(之後的票都經 StoreCountModeService.settingOf)
      const service = api.app.get(StoreCountModeService);
      const operator = await operatorOf(manager, zhongshan);
      await expect(
        service.settingOf(operator, zhongshan, "renumber_reminder"),
      ).resolves.toBe("biweekly");
    });

    it("店長只有 view:看得到、canEdit = false,[自訂] / [還原] → FORBIDDEN", async () => {
      const page = await settingsOf(manager);
      expect(page.orgName).toBe("中山店");
      expect(page.canEdit).toBe(false);
      expect(
        extensionsOf(
          await customize(manager, zhongshan, "renumber_reminder", "none"),
        ),
      ).toMatchObject({ code: "FORBIDDEN", reason: "MISSING_PERMISSION" });
      expect(
        extensionsOf(await restore(manager, zhongshan, "renumber_reminder")),
      ).toMatchObject({ code: "FORBIDDEN" });
    });

    it("最上層組織要 edit-default、其他組織要 edit-org", async () => {
      const top = await settingsOf(orgEditor, tenant);
      expect(top.canEdit).toBe(false);
      expect(
        extensionsOf(
          await customize(orgEditor, tenant, "transfer_grid_pick", "off"),
        ),
      ).toMatchObject({ code: "FORBIDDEN", reason: "MISSING_PERMISSION" });
      dataOf(
        await customize(orgEditor, north, "transfer_grid_pick", "off"),
        "customizeLotterySetting",
      );
    });

    it("沒有這個模組的權限 → FORBIDDEN;看不到的組織 → NOT_FOUND;不合法的 key / 選項 → VALIDATION_FAILED", async () => {
      expect(extensionsOf(await gql(outsider, SETTINGS))).toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        extensionsOf(
          await gql(manager, SETTINGS, { input: { orgId: String(hsinchu) } }),
        ),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(
        extensionsOf(await customize(hq, zhongshan, "nope", "on")),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["key"] });
      expect(
        extensionsOf(await customize(hq, zhongshan, "count_mode", "weird")),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["option"] });
    });

    it("異動留稽核紀錄(自訂、還原)", async () => {
      const logs = await connection
        .collection("audit_logs")
        .find({ targetType: "lottery_setting" })
        .toArray();
      expect(logs.map((log) => log.action as string)).toEqual(
        expect.arrayContaining([
          "lottery-setting.customize",
          "lottery-setting.restore",
        ]),
      );
      const customized = logs.find(
        (log) =>
          log.action === "lottery-setting.customize" &&
          (log.after as { value: { option: string } }).value.option === "none",
      );
      expect(customized?.actorId).toEqual(hq.userId);
    });
  });

  describe("SET3 調貨單可點格子選張", () => {
    beforeAll(resetWorld);

    it("預設開;關掉後分店讀到「關」", async () => {
      const service = api.app.get(StoreCountModeService);
      const operator = await operatorOf(hq, tenant);
      await expect(
        service.settingOf(operator, minsheng, "transfer_grid_pick"),
      ).resolves.toBe("on");
      await customize(hq, tenant, "transfer_grid_pick", "off");
      await expect(
        service.settingOf(operator, minsheng, "transfer_grid_pick"),
      ).resolves.toBe("off");
    });
  });

  describe("SW1、SET2 改盤點制度:當下生效 / 轉換中,上層改預設時下層同一個交易重算", () => {
    beforeAll(resetWorld);

    it("分店 編號 → 張數:當下生效,歷程記一筆", async () => {
      const page = dataOf(
        await customize(hq, hsinchu, "count_mode", "count"),
        "customizeLotterySetting",
      ).settings;
      expect(page.storeCountMode?.mode).toBe("count");
      const doc = await modeDocOf(hsinchu);
      expect(doc?.history).toEqual([
        expect.objectContaining({
          from: "numbered",
          to: "count",
          cause: "setting",
          by: hq.userId,
        }),
      ]);
      expect(doc?.version).toBe(1);
    });

    it("張數 → 編號,沒有未對號:直接改成編號", async () => {
      await customize(hq, hsinchu, "count_mode", "numbered");
      expect(await modeOf(hsinchu)).toBe("numbered");
    });

    it("上層改預設:檢查列出會跟著改的分店(自訂了的不列),存了之後下層一起改,查詢數不隨分店數成長", async () => {
      // 新竹店自訂了編號:不跟著改
      const listed = await check(hq, tenant, "count");
      expect(
        listed.stores.map((store) => [store.orgName, store.from, store.to]),
      ).toEqual(
        expect.arrayContaining([
          ["中山店", "numbered", "count"],
          ["民生店", "numbered", "count"],
        ]),
      );
      expect(listed.stores.map((store) => store.orgName)).not.toContain(
        "新竹店",
      );
      expect(listed.canSave).toBe(true);

      const counted = await countDbCommands(() =>
        customize(hq, tenant, "count_mode", "count"),
      );
      dataOf(counted.result, "customizeLotterySetting");
      // 一次 aggregate 算未對號(檯面待標註的本沒有 → 不查收銀點);分店那一筆一次讀、一次批次寫
      expect(
        counted.byCommand.get(`${LOTTERY_TICKETS_COLLECTION}.aggregate`) ?? 0,
      ).toBeLessThanOrEqual(1);
      expect(
        counted.byCommand.get(`${LOTTERY_STORE_COUNT_MODES_COLLECTION}.find`) ??
          0,
      ).toBeLessThanOrEqual(1);
      expect(
        counted.byCommand.get(
          `${LOTTERY_STORE_COUNT_MODES_COLLECTION}.insertMany`,
        ) ?? 0,
      ).toBeLessThanOrEqual(1);
      expect(await modeOf(zhongshan)).toBe("count");
      expect(await modeOf(minsheng)).toBe("count");
      expect(await modeOf(hsinchu)).toBe("numbered");

      const logs = await connection
        .collection("audit_logs")
        .find({ action: "lottery-store-count-mode.change" })
        .toArray();
      expect(logs.map((log) => String(log.targetId))).toEqual(
        expect.arrayContaining([String(zhongshan), String(minsheng)]),
      );
    });

    it("張數 → 編號,還有未對號:進轉換中;沒有的直接編號", async () => {
      await insertUnmatchedTicket(zhongshan);
      const listed = await check(hq, tenant, "numbered");
      expect(
        listed.stores
          .map((store) => [store.orgName, store.to])
          .toSorted((left, right) =>
            String(left[0]).localeCompare(String(right[0])),
          ),
      ).toEqual(
        [
          ["中山店", "converting"],
          ["民生店", "numbered"],
        ].toSorted((left, right) =>
          String(left[0]).localeCompare(String(right[0])),
        ),
      );
      const page = dataOf(
        await customize(hq, tenant, "count_mode", "numbered"),
        "customizeLotterySetting",
      ).settings;
      expect(page.storeCountMode).toBeNull();
      expect(await modeOf(zhongshan)).toBe("converting");
      expect(await modeOf(minsheng)).toBe("numbered");

      const store = await settingsOf(hq, zhongshan);
      expect(store.storeCountMode).toMatchObject({
        mode: "converting",
        canCancelConversion: true,
      });
      // 店長只有 view:看得到轉換中,不能按 [取消轉換]
      const own = await settingsOf(manager);
      expect(own.storeCountMode).toMatchObject({
        mode: "converting",
        canCancelConversion: false,
      });
    });
  });

  describe("SW3 [取消轉換]", () => {
    it("店長不能按;不是轉換中的店 → NOT_CONVERTING", async () => {
      expect(
        extensionsOf(
          await gql(manager, CANCEL_CONVERSION, {
            input: { orgId: String(zhongshan) },
          }),
        ),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        extensionsOf(
          await gql(hq, CANCEL_CONVERSION, {
            input: { orgId: String(minsheng) },
          }),
        ),
      ).toMatchObject({ code: "VALIDATION_FAILED", reason: "NOT_CONVERTING" });
    });

    it("回到張數、歷程記「轉換中 → 張數」、等於本店自訂張數,之後上層預設再改也不跟著動", async () => {
      const page = dataOf(
        await gql(hq, CANCEL_CONVERSION, {
          input: { orgId: String(zhongshan) },
        }),
        "cancelLotteryCountModeConversion",
      ).settings;
      expect(page.storeCountMode?.mode).toBe("count");
      expect(itemOf(page, "count_mode").effective).toMatchObject({
        option: "count",
        source: "own",
      });
      const doc = await modeDocOf(zhongshan);
      expect(doc?.history.at(-1)).toMatchObject({
        from: "converting",
        to: "count",
        cause: "convert_cancelled",
      });

      const listed = await check(hq, tenant, "count");
      expect(listed.stores.map((store) => store.orgName)).not.toContain(
        "中山店",
      );
      await customize(hq, tenant, "count_mode", "count");
      await customize(hq, tenant, "count_mode", "numbered");
      expect(await modeOf(zhongshan)).toBe("count");

      // [還原] 才恢復沿用(租戶預設是編號、還有未對號 → 進轉換中)
      await restore(hq, zhongshan, "count_mode");
      expect(await modeOf(zhongshan)).toBe("converting");
    });

    it("[變更紀錄]:新到舊,附誰、為什麼", async () => {
      const history = await historyOf(manager, zhongshan);
      expect(history.orgName).toBe("中山店");
      expect(
        history.items.map((item) => [item.from, item.to, item.cause]),
      ).toEqual([
        ["count", "converting", "setting"],
        ["converting", "count", "convert_cancelled"],
        ["count", "converting", "setting"],
        ["numbered", "count", "setting"],
      ]);
      expect(history.items[0]?.byName).toBe("何家華");
    });
  });

  describe("9.1 切換前的檢查:檯面待標註、進行中的盤點 / 重刷 / 補點", () => {
    beforeAll(resetWorld);

    it("S12(16.7)改張數:列出檯面上還有待標註的本,不能存", async () => {
      await insertPendingSkipBook();
      const listed = await check(hq, minsheng, "count");
      expect(listed.canSave).toBe(false);
      expect(listed.stores).toEqual([
        expect.objectContaining({
          orgName: "民生店",
          problems: ["pending_skip"],
        }),
      ]);
      expect(listed.pendingSkipBooks).toEqual([
        {
          orgName: "民生店",
          cashPointName: "店內櫃台",
          gameCode: "5201",
          gameName: "金好運",
          bookNo: "060116",
          pendingCount: 2,
        },
      ]);
      expect(
        extensionsOf(await customize(hq, minsheng, "count_mode", "count")),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "COUNT_MODE_CHANGE_BLOCKED",
      });
      // 沒寫入:設定與實際制度都沒變
      expect(await modeOf(minsheng)).toBe("numbered");
      expect(
        itemOf(await settingsOf(hq, minsheng), "count_mode").effective.option,
      ).toBe("numbered");
    });

    it("上層改預設時,會跟著改成張數的分店有待標註 → 整筆不能存;先幫那家店 [自訂] 成編號就可以", async () => {
      const listed = await check(hq, tenant, "count");
      expect(listed.canSave).toBe(false);
      expect(
        listed.stores.find((store) => store.orgName === "民生店")?.problems,
      ).toEqual(["pending_skip"]);
      expect(
        listed.stores.find((store) => store.orgName === "中山店")?.problems,
      ).toEqual([]);
      expect(
        extensionsOf(await customize(hq, tenant, "count_mode", "count")),
      ).toMatchObject({ reason: "COUNT_MODE_CHANGE_BLOCKED" });
      expect(await modeOf(zhongshan)).toBe("numbered");

      await customize(hq, minsheng, "count_mode", "numbered");
      dataOf(
        await customize(hq, tenant, "count_mode", "count"),
        "customizeLotterySetting",
      );
      expect(await modeOf(zhongshan)).toBe("count");
      expect(await modeOf(minsheng)).toBe("numbered");
    });

    it("有登記盤點中(1 小時內有操作):兩個方向都不能改;超過 1 小時失效就可以", async () => {
      const sessions = connection.collection(
        LOTTERY_STORE_COUNT_MODES_COLLECTION,
      );
      await sessions.updateOne(
        { orgId: zhongshan },
        {
          $set: {
            stocktakeSessions: [
              {
                sessionId: "s-1",
                cashPointIds: [],
                by: manager.userId,
                startedAt: new Date(),
                lastActiveAt: new Date(),
                draft: null,
              },
            ],
          },
        },
      );
      const listed = await check(hq, zhongshan, "numbered");
      expect(listed.canSave).toBe(false);
      expect(listed.busyStores).toEqual([
        {
          orgName: "中山店",
          stocktake: true,
          rescan: false,
          renumber: false,
        },
      ]);
      expect(
        extensionsOf(await customize(hq, zhongshan, "count_mode", "numbered")),
      ).toMatchObject({ reason: "COUNT_MODE_CHANGE_BLOCKED" });
      expect(await modeOf(zhongshan)).toBe("count");

      await sessions.updateOne(
        { orgId: zhongshan },
        {
          $set: {
            "stocktakeSessions.0.lastActiveAt": new Date(
              Date.now() - 61 * 60_000,
            ),
          },
        },
      );
      const expired = await check(hq, zhongshan, "numbered");
      expect(expired.canSave).toBe(true);
    });

    it("全店重刷或補點編號還沒結束:不能改", async () => {
      const sessions = connection.collection(
        LOTTERY_STORE_COUNT_MODES_COLLECTION,
      );
      await sessions.updateOne(
        { orgId: zhongshan },
        {
          $set: {
            stocktakeSessions: [],
            movePauses: [{ stocktakeId: new Types.ObjectId(), gameId: game }],
          },
        },
      );
      const rescanning = await check(hq, zhongshan, "numbered");
      expect(rescanning.busyStores).toEqual([
        expect.objectContaining({ rescan: true, renumber: false }),
      ]);
      await sessions.updateOne(
        { orgId: zhongshan },
        {
          $set: {
            movePauses: [{ stocktakeId: new Types.ObjectId(), gameId: null }],
          },
        },
      );
      const listed = await check(hq, tenant, "numbered");
      expect(listed.canSave).toBe(false);
      expect(listed.busyStores).toEqual([
        expect.objectContaining({ orgName: "中山店", renumber: true }),
      ]);
      // [還原](回到沿用)一樣擋
      expect(
        extensionsOf(await restore(hq, tenant, "count_mode")),
      ).toMatchObject({ reason: "COUNT_MODE_CHANGE_BLOCKED" });
      await sessions.updateOne(
        { orgId: zhongshan },
        { $set: { movePauses: [] } },
      );
      dataOf(await restore(hq, tenant, "count_mode"), "restoreLotterySetting");
      expect(await modeOf(zhongshan)).toBe("numbered");
    });
  });
});
