import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import { STORE_PERMISSIONS as S } from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import { OperatorContextService } from "../../../auth/operator-context.service";
import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { PASSWORD, login } from "../../../fields/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "../../database/lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_GAMES_COLLECTION } from "../../database/lottery-games/lottery-game.schema";
import { LOTTERY_BOOKS_COLLECTION } from "../../database/lottery-inventory/lottery-book.schema";
import { LOTTERY_TICKETS_COLLECTION } from "../../database/lottery-inventory/lottery-ticket.schema";
import { LotteryShiftPersonLock } from "../../database/lottery-store/lottery-shift-person-lock.schema";
import {
  LOTTERY_SHIFTS_COLLECTION,
  LotteryShift,
} from "../../database/lottery-store/lottery-shift.schema";
import { SCHEDULE_DEMANDS_COLLECTION } from "../../database/schedule/schedule-demand.schema";
import { ScheduleEntryLock } from "../../database/schedule/schedule-entry-lock.schema";
import { SCHEDULE_ENTRIES_COLLECTION } from "../../database/schedule/schedule-entry.schema";
import { SCHEDULE_PERIODS_COLLECTION } from "../../database/schedule/schedule-period.schema";
import { SCHEDULE_TASK_ASSIGNMENTS_COLLECTION } from "../../database/schedule/schedule-task-assignment.schema";
import { positionAnnotationsOf } from "../../schedule/integration/position-annotations";
import { ScheduleRosterWritesService } from "../../schedule/roster/schedule-roster-writes.service";
import { ScheduleClock } from "../../schedule/shared/schedule-clock";
import {
  SCHEDULE_TEST_PERMISSIONS as SP,
  seedScheduleAuthorization,
} from "../../schedule/test-support/fixtures";
import { isCashPointDeactivationBlocked } from "../cash-points/cash-point-deactivation";
import { openDrawersOf, openShiftOf } from "../cash/open-shift";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { StoreClock } from "./store-clock";

// ---- GraphQL ----

const SHIFT_FIELDS = /* GraphQL */ `
  id
  cashPoint { id name }
  openedBy { id name }
  isMine
  openingFloat
  expectedCash
  soldCount
  soldAmount
  unmatchedEntry
`;

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        org { id name }
        cashPoints {
          id
          name
          shift { ${SHIFT_FIELDS} }
          books { bookNo gameName color unitPrice remaining total soldToday isLowStock }
        }
        myOpenShifts { ${SHIFT_FIELDS} }
        vaultExpected
      }
    }
  }
`;

const OPEN_FORM = /* GraphQL */ `
  query OpenForm($cashPointId: ID!) {
    lotteryStoreOpenShiftForm(cashPointId: $cashPointId) {
      item {
        plan
        handoverAmount
        canTakeFloat
        suggestedEntryId
        entries {
          id
          snapshot {
            role
            taskKey
            positionKey
          }
          hasStartPunch
        }
      }
    }
  }
`;

const OPEN = /* GraphQL */ `
  mutation Open($input: OpenLotteryShiftInput!) {
    openLotteryShift(input: $input) { item { ${SHIFT_FIELDS} } }
  }
`;

const PUNCH = /* GraphQL */ `
  mutation Punch($entryId: ID!) {
    punchLotteryShiftStart(entryId: $entryId) {
      entryId
      at
    }
  }
`;

const INFO_FIELDS = /* GraphQL */ `
  id
  openingFloat
  openingFloatSource
  entry { id hasStartPunch }
  taskSnapshot { role taskKey positionKey }
  positionMismatch
  closed
  canReassign
  entryOptions { id }
`;

const INFO = /* GraphQL */ `
  query Info($id: ID!) {
    lotteryShiftInfo(id: $id) { item { ${INFO_FIELDS} } }
  }
`;

const REASSIGN = /* GraphQL */ `
  mutation Reassign($input: ReassignLotteryShiftEntryInput!) {
    reassignLotteryShiftEntry(input: $input) { item { ${INFO_FIELDS} } }
  }
`;

const DEPOSIT = /* GraphQL */ `
  mutation Deposit($input: DepositLotteryShiftCashInput!) {
    depositLotteryShiftCash(input: $input) { item { ${SHIFT_FIELDS} } }
  }
`;

const WITHDRAW = /* GraphQL */ `
  mutation Withdraw($input: WithdrawLotteryShiftCashInput!) {
    withdrawLotteryShiftCash(input: $input) { item { ${SHIFT_FIELDS} } }
  }
`;

// ---- 型別 ----

interface ShiftRow {
  id: string;
  cashPoint: { id: string; name: string };
  openedBy: { id: string; name: string };
  isMine: boolean;
  openingFloat: number;
  expectedCash: number;
  soldCount: number;
  soldAmount: number;
  unmatchedEntry: boolean;
}

interface InfoRow {
  id: string;
  openingFloat: number;
  openingFloatSource: string;
  entry: { id: string; hasStartPunch: boolean } | null;
  taskSnapshot: { role: string; taskKey: string; positionKey: string } | null;
  positionMismatch: boolean;
  closed: boolean;
  canReassign: boolean;
  entryOptions: { id: string }[];
}

interface StoreUser {
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

const taipei = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`);

/** 看板卡片的夾具:前 3 張是昨天賣的。 */
const soldDayOf = (index: number) => (index < 3 ? "2026-11-04" : "2026-11-05");

/**
 * 店面(一):看板、開班 / 班次、改對應排班、投庫 / 出庫與對其他功能的登記(規格 6.1、6.2、6.6、6.7、14.9):
 * 打真的 GraphQL 端點、對真 MongoDB(TEST-07);「現在」由 `StoreClock` / `ScheduleClock` 注入。
 *
 * 組織樹:root ─ 租戶甲 ─┬─ 信義店(店內櫃台、店外攤位、彩券機旁、補貨區)
 *                        └─ 板橋店(店內櫃台)
 * 11/5 王:08:00–16:00 信義店(負責 · 店內櫃台);16:00–22:00 信義店(協同 · 補貨)。林:08:00–16:00 信義店(店外攤位)。
 */
describe("店面(一):看板、收銀班次、投庫 / 出庫(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;

  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let banqiao: Types.ObjectId;

  let counter: Types.ObjectId;
  let stall: Types.ObjectId;
  let lotteryDesk: Types.ObjectId;
  let restockDesk: Types.ObjectId;
  let counterB: Types.ObjectId;

  /** 店員:看板、開班、投庫、出庫 + 我的班表打卡;信義店、板橋店都是所屬組織 */
  let wang: StoreUser;
  /** 店員:看板、開班(沒有投庫 / 出庫) */
  let lin: StoreUser;
  /** 店長:店面管理全部 */
  let manager: StoreUser;
  /** 沒有店面管理 */
  let outsider: StoreUser;

  let wangMorning: Types.ObjectId;
  let wangEvening: Types.ObjectId;
  let linMorning: Types.ObjectId;

  let counterShift: string;
  let stallShift: string;

  let sequence = 0;

  function gql(
    user: StoreUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> {
    return api.graphql(query, variables, { accessToken: user.token });
  }

  async function ok<T>(
    user: StoreUser,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const result = await gql(user, query, variables);
    expect(result.errors).toBeUndefined();
    return result.data as T;
  }

  async function errorOf(
    user: StoreUser,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await gql(user, query, variables);
    return result.errors?.[0]?.extensions;
  }

  function now(date: string, time: string): void {
    jest
      .spyOn(api.app.get(StoreClock), "now")
      .mockReturnValue(taipei(date, time));
    jest
      .spyOn(api.app.get(ScheduleClock), "now")
      .mockReturnValue(taipei(date, time));
  }

  async function storeUser(
    orgIds: Types.ObjectId[],
    permissionKeys: readonly string[],
    name: string,
  ): Promise<StoreUser> {
    sequence += 1;
    const account = `store-user-${String(sequence)}`;
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds,
    });
    await connection
      .collection("users")
      .updateOne({ _id: userId }, { $set: { name } });
    const [ownerOrgId] = orgIds;
    if (ownerOrgId === undefined) {
      throw new Error("需要所屬組織");
    }
    await createRole(api.app, connection, {
      name: `店面角色:${account}`,
      ownerOrgId,
      moduleKeys: ["store", "schedule", "schedule.my", "schedule.manage"],
      permissionKeys: [...permissionKeys],
      assignTo: [userId],
    });
    return { userId, token: await login(api, account) };
  }

  async function cashPoint(
    orgId: Types.ObjectId,
    name: string,
    positionKey: string,
    order: number,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        positionKey,
        name,
        order,
        enabled: true,
        printerId: null,
        note: null,
        moduleKey: "master-data",
        ...base(),
      });
    return insertedId;
  }

  async function entry(
    userId: Types.ObjectId,
    date: string,
    start: string,
    end: string,
    role: "leader" | "helper",
    positionKey: string,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(SCHEDULE_ENTRIES_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        userId,
        date,
        startAt: taipei(date, start),
        endAt: taipei(date, end),
        breakMinutes: 30,
        moduleKey: "schedule.manage",
        ...base(),
      });
    const { insertedId: demandId } = await connection
      .collection(SCHEDULE_DEMANDS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        date,
        startAt: taipei(date, start),
        endAt: taipei(date, end),
        positionKey,
        tasks: [
          {
            taskId: "t0",
            role,
            taskKey: role === "leader" ? "store-and-accounts-lead" : "store",
          },
        ],
        templateId: null,
        source: "manual",
        moduleKey: "schedule.manage",
        ...base(),
      });
    await connection
      .collection(SCHEDULE_TASK_ASSIGNMENTS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        entryId: insertedId,
        demandId,
        taskId: "t0",
        source: "manual",
        autoRunId: null,
        reason: null,
        moduleKey: "schedule.manage",
        ...base(),
      });
    return insertedId;
  }

  async function operatorOf(user: StoreUser) {
    const resolved = await api.app
      .get(OperatorContextService)
      .resolve(user.userId, xinyi);
    return resolved.operator;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-lottery-store");
    connection = api.connection;
    await api.app
      .get<Model<LotteryShift>>(getModelToken(LotteryShift.name))
      .init();
    await api.app
      .get<Model<LotteryShiftPersonLock>>(
        getModelToken(LotteryShiftPersonLock.name),
      )
      .init();
    await api.app
      .get<Model<ScheduleEntryLock>>(getModelToken(ScheduleEntryLock.name))
      .init();
    await seedScheduleAuthorization(connection);
    const { insertedId: storeModuleId } = await connection
      .collection("modules")
      .insertOne({
        key: "store",
        name: "店面管理",
        parentId: null,
        ancestors: [],
        route: "store",
        sidebarType: "link",
        order: 10,
        enabled: true,
        isSystem: false,
        icon: null,
        settings: {},
        engine: "fixed",
        ...base(),
      });
    await connection.collection("permissions").insertMany(
      Object.values(S).map((key) => ({
        key,
        moduleId: storeModuleId,
        name: key,
        enabled: true,
        isSystem: false,
        settings: {},
        source: "seed",
        retiredAt: null,
        ...base(),
      })),
    );
    await seedReasonCategory(
      connection,
      SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason,
      [
        { value: "wrong-entry-at-open", label: "開班時選錯排班" },
        { value: "other", label: "其他" },
      ],
    );
    await seedReasonCategory(
      connection,
      LOTTERY_FIELD_CATEGORY_KEYS.withdrawReason,
      [
        { value: "opening-float", label: "開班零用金" },
        { value: "change-refill", label: "補零錢" },
        { value: "other", label: "其他" },
      ],
    );

    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    banqiao = await createOrg(connection, { name: "板橋店", parentId: tenant });

    counter = await cashPoint(xinyi, "店內櫃台", "in-store-counter", 1);
    stall = await cashPoint(xinyi, "店外攤位", "outdoor-stall", 2);
    lotteryDesk = await cashPoint(xinyi, "彩券機旁", "lottery-machine", 3);
    restockDesk = await cashPoint(xinyi, "補貨區", "restock-desk", 4);
    counterB = await cashPoint(banqiao, "店內櫃台", "in-store-counter", 1);

    wang = await storeUser(
      [xinyi, banqiao],
      [S.view, S.openShift, S.deposit, S.withdraw, SP.myView, SP.myPunch],
      "王小明",
    );
    lin = await storeUser([xinyi], [S.view, S.openShift], "林小美");
    manager = await storeUser(
      [xinyi],
      [S.view, S.edit, S.openShift, SP.manageView, SP.manageEdit],
      "陳店長",
    );
    outsider = await storeUser([xinyi], [SP.myView], "路人");

    await connection.collection(SCHEDULE_PERIODS_COLLECTION).insertOne({
      orgId: xinyi,
      tenantId: tenant,
      month: "2026-11",
      status: "published",
      publishedAt: new Date(),
      publishedBy: null,
      lockedAt: null,
      lockedBy: null,
      version: 0,
      moduleKey: "schedule.manage",
      ...base(),
    });
    wangMorning = await entry(
      wang.userId,
      "2026-11-05",
      "08:00",
      "16:00",
      "leader",
      "in-store-counter",
    );
    wangEvening = await entry(
      wang.userId,
      "2026-11-05",
      "16:00",
      "22:00",
      "helper",
      "restock",
    );
    linMorning = await entry(
      lin.userId,
      "2026-11-05",
      "08:00",
      "16:00",
      "helper",
      "outdoor-stall",
    );
  }, HOOK_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("看板:沒有 store.view → FORBIDDEN;收銀點依排序、都未開班", async () => {
    now("2026-11-05", "08:10");
    expect(
      await errorOf(outsider, BOARD, { orgId: String(xinyi) }),
    ).toMatchObject({ code: "FORBIDDEN" });
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: { name: string; shift: ShiftRow | null }[];
          myOpenShifts: ShiftRow[];
        };
      };
    }>(wang, BOARD, { orgId: String(xinyi) });
    expect(
      data.lotteryStoreBoard.item.cashPoints.map((point) => [
        point.name,
        point.shift,
      ]),
    ).toEqual([
      ["店內櫃台", null],
      ["店外攤位", null],
      ["彩券機旁", null],
      ["補貨區", null],
    ]);
    expect(data.lotteryStoreBoard.item.myOpenShifts).toEqual([]);
  });

  it("開班視窗:第一班可領零用金;對應排班預選 = findEntryForShift;收銀點崗位那一筆是快照", async () => {
    now("2026-11-05", "08:10");
    const data = await ok<{
      lotteryStoreOpenShiftForm: {
        item: {
          plan: string;
          canTakeFloat: boolean;
          suggestedEntryId: string | null;
          entries: {
            id: string;
            snapshot: { role: string } | null;
            hasStartPunch: boolean;
          }[];
        };
      };
    }>(wang, OPEN_FORM, { cashPointId: String(counter) });
    const form = data.lotteryStoreOpenShiftForm.item;
    expect(form).toMatchObject({
      plan: "first",
      canTakeFloat: true,
      suggestedEntryId: String(wangMorning),
    });
    expect(
      form.entries.map((item) => [
        item.id,
        item.snapshot?.role ?? null,
        item.hasStartPunch,
      ]),
    ).toEqual([
      [String(wangMorning), "leader", false],
      [String(wangEvening), null, false],
    ]);
    // 沒有出庫權限:不顯示「從小金庫領零用金」
    const linForm = await ok<{
      lotteryStoreOpenShiftForm: { item: { canTakeFloat: boolean } };
    }>(lin, OPEN_FORM, { cashPointId: String(stall) });
    expect(linForm.lotteryStoreOpenShiftForm.item.canTakeFloat).toBe(false);
  });

  it("開班:對應排班必選;不是自己的排班 → ENTRY_NOT_AVAILABLE;沒有出庫權限領零用金 → 擋下", async () => {
    now("2026-11-05", "08:10");
    expect(
      await errorOf(lin, OPEN, {
        input: { cashPointId: String(stall), temporaryCover: false },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["scheduleEntryId"] });
    expect(
      await errorOf(lin, OPEN, {
        input: {
          cashPointId: String(stall),
          scheduleEntryId: String(wangMorning),
          temporaryCover: false,
        },
      }),
    ).toMatchObject({ reason: "ENTRY_NOT_AVAILABLE" });
    expect(
      await errorOf(lin, OPEN, {
        input: {
          cashPointId: String(stall),
          scheduleEntryId: String(linMorning),
          temporaryCover: false,
          floatFromVault: 1000,
        },
      }),
    ).toMatchObject({ reason: "OPENING_FLOAT_NOT_ALLOWED" });
    expect(
      await connection
        .collection(LOTTERY_SHIFTS_COLLECTION)
        .countDocuments({ cashPointId: stall }),
    ).toBe(0);
  });

  it("開班:領零用金 3,000 → 期初 3,000、同一交易寫出庫(開班零用金);崗位一致記任務快照", async () => {
    now("2026-11-05", "08:10");
    const data = await ok<{ openLotteryShift: { item: ShiftRow } }>(
      wang,
      OPEN,
      {
        input: {
          cashPointId: String(counter),
          scheduleEntryId: String(wangMorning),
          temporaryCover: false,
          floatFromVault: 3000,
        },
      },
    );
    const shift = data.openLotteryShift.item;
    counterShift = shift.id;
    expect(shift).toMatchObject({
      openedBy: { id: String(wang.userId), name: "王小明" },
      isMine: true,
      openingFloat: 3000,
      expectedCash: 3000,
      unmatchedEntry: false,
    });
    const movements = await connection
      .collection(LOTTERY_CASH_MOVEMENTS_COLLECTION)
      .find<{
        type: string;
        from: string;
        to: string;
        amount: number;
        reason: string | null;
      }>({ shiftId: new Types.ObjectId(counterShift) })
      .toArray();
    expect(
      movements.map((row) => [
        row.type,
        row.from,
        row.to,
        row.amount,
        row.reason,
      ]),
    ).toEqual([["withdraw", "vault", "drawer", 3000, "opening_float"]]);
    const stored = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .findOne({ _id: new Types.ObjectId(counterShift) });
    expect(stored).toMatchObject({
      openingFloatSource: "vault",
      scheduleEntryId: wangMorning,
      scheduleTaskSnapshot: {
        role: "leader",
        taskKey: "store-and-accounts-lead",
        positionKey: "in-store-counter",
      },
      positionMismatch: null,
    });
  });

  it("同一人同店兩個收銀點 → 可以;崗位不一致 → 記 positionMismatch、快照空白", async () => {
    now("2026-11-05", "16:05");
    const data = await ok<{ openLotteryShift: { item: ShiftRow } }>(
      wang,
      OPEN,
      {
        input: {
          cashPointId: String(stall),
          scheduleEntryId: String(wangEvening),
          temporaryCover: false,
        },
      },
    );
    stallShift = data.openLotteryShift.item.id;
    expect(data.openLotteryShift.item.openingFloat).toBe(0);
    const stored = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .findOne({ _id: new Types.ObjectId(stallShift) });
    expect(stored).toMatchObject({
      openingFloatSource: "none",
      scheduleTaskSnapshot: null,
      positionMismatch: {
        cashPointPositionKey: "outdoor-stall",
        entryPositionKeys: ["restock"],
      },
    });
    const board = await ok<{
      lotteryStoreBoard: { item: { myOpenShifts: ShiftRow[] } };
    }>(wang, BOARD, { orgId: String(xinyi) });
    expect(
      board.lotteryStoreBoard.item.myOpenShifts.map(
        (shift) => shift.cashPoint.name,
      ),
    ).toEqual(expect.arrayContaining(["店內櫃台", "店外攤位"]));
  });

  it("同一人同時開兩家店的班 → SHIFT_IN_OTHER_STORE", async () => {
    now("2026-11-05", "16:10");
    expect(
      await errorOf(wang, OPEN, {
        input: { cashPointId: String(counterB), temporaryCover: true },
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "SHIFT_IN_OTHER_STORE",
    });
  });

  it("同一收銀點同時兩人開班 → 一個成功、另一個 SHIFT_ALREADY_OPEN;臨時代班 = 未對應排班", async () => {
    now("2026-11-05", "09:00");
    const results = await Promise.all(
      [lin, manager].map((user) =>
        gql(user, OPEN, {
          input: { cashPointId: String(lotteryDesk), temporaryCover: true },
        }),
      ),
    );
    const succeeded = results.filter((result) => result.errors === undefined);
    const failed = results.find((result) => result.errors !== undefined);
    expect(succeeded).toHaveLength(1);
    expect(failed?.errors?.[0]?.extensions).toMatchObject({
      reason: "SHIFT_ALREADY_OPEN",
    });
    expect(
      (succeeded[0]?.data as { openLotteryShift: { item: ShiftRow } })
        .openLotteryShift.item.unmatchedEntry,
    ).toBe(true);
    expect(
      await connection.collection(LOTTERY_SHIFTS_COLLECTION).findOne({
        cashPointId: lotteryDesk,
      }),
    ).toMatchObject({ scheduleEntryId: null, scheduleTaskSnapshot: null });
  });

  it("開班視窗 [打卡]:打這一班的上班卡;班次資訊顯示已打卡", async () => {
    now("2026-11-05", "08:15");
    const punched = await ok<{
      punchLotteryShiftStart: { entryId: string };
    }>(wang, PUNCH, { entryId: String(wangMorning) });
    expect(punched.punchLotteryShiftStart.entryId).toBe(String(wangMorning));
    const info = await ok<{ lotteryShiftInfo: { item: InfoRow } }>(wang, INFO, {
      id: counterShift,
    });
    expect(info.lotteryShiftInfo.item).toMatchObject({
      openingFloat: 3000,
      openingFloatSource: "vault",
      entry: { id: String(wangMorning), hasStartPunch: true },
      taskSnapshot: { role: "leader" },
      positionMismatch: false,
      closed: false,
      canReassign: true,
    });
  });

  it("被班次綁定的排班在排班作業刪除 → 被擋(經登記接縫);崗位旁顯示收銀點名稱", async () => {
    const operator = await operatorOf(manager);
    await expect(
      api.app.get(ScheduleRosterWritesService).deleteEntry(operator, {
        id: String(wangEvening),
        orgId: String(xinyi),
      }),
    ).rejects.toMatchObject({
      extensions: { blockedEntryIds: [String(wangEvening)] },
    });
    expect(
      await positionAnnotationsOf(String(tenant), String(xinyi)),
    ).toMatchObject({
      "in-store-counter": "店內櫃台",
      "outdoor-stall": "店外攤位",
    });
  });

  it("改對應排班:非負責人非店長 → FORBIDDEN;原因必填;負責人改成另一筆 → 重寫快照、記稽核", async () => {
    now("2026-11-05", "10:00");
    expect(
      await errorOf(lin, REASSIGN, {
        input: {
          shiftId: counterShift,
          temporaryCover: true,
          reasonKey: "wrong-entry-at-open",
        },
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(wang, REASSIGN, {
        input: { shiftId: counterShift, temporaryCover: true },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonKey"] });
    const data = await ok<{ reassignLotteryShiftEntry: { item: InfoRow } }>(
      wang,
      REASSIGN,
      {
        input: {
          shiftId: counterShift,
          scheduleEntryId: String(wangEvening),
          temporaryCover: false,
          reasonKey: "wrong-entry-at-open",
        },
      },
    );
    expect(data.reassignLotteryShiftEntry.item).toMatchObject({
      entry: { id: String(wangEvening) },
      taskSnapshot: null,
      positionMismatch: true,
    });
    const audit = await connection
      .collection("audit_logs")
      .findOne({ action: "lottery-shift.reassign-entry" });
    expect(audit).toMatchObject({
      targetType: "lottery_shift",
      after: { reasonKey: "wrong-entry-at-open" },
    });
    // 店長可以改別人的班(改回原本的排班)
    const byManager = await ok<{
      reassignLotteryShiftEntry: { item: InfoRow };
    }>(manager, REASSIGN, {
      input: {
        shiftId: counterShift,
        scheduleEntryId: String(wangMorning),
        temporaryCover: false,
        reasonKey: "other",
        reasonNote: "改回早班",
      },
    });
    expect(byManager.reassignLotteryShiftEntry.item).toMatchObject({
      entry: { id: String(wangMorning) },
      taskSnapshot: { role: "leader" },
      positionMismatch: false,
    });
  });

  it("投庫 / 出庫:應有現金即時變化;投庫超過抽屜應有 → 擋下;沒有權限 → FORBIDDEN", async () => {
    const deposited = await ok<{ depositLotteryShiftCash: { item: ShiftRow } }>(
      wang,
      DEPOSIT,
      { input: { shiftId: counterShift, amount: 1000 } },
    );
    expect(deposited.depositLotteryShiftCash.item.expectedCash).toBe(2000);
    expect(
      await errorOf(wang, DEPOSIT, {
        input: { shiftId: counterShift, amount: 2001 },
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "AMOUNT_EXCEEDS_DRAWER",
    });
    expect(
      await errorOf(lin, DEPOSIT, {
        input: { shiftId: counterShift, amount: 100 },
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(wang, WITHDRAW, {
        input: { shiftId: counterShift, amount: 500 },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonKey"] });
    const withdrawn = await ok<{
      withdrawLotteryShiftCash: { item: ShiftRow };
    }>(wang, WITHDRAW, {
      input: { shiftId: counterShift, amount: 500, reasonKey: "change-refill" },
    });
    expect(withdrawn.withdrawLotteryShiftCash.item.expectedCash).toBe(2500);
    const last = await connection
      .collection(LOTTERY_CASH_MOVEMENTS_COLLECTION)
      .find({ shiftId: new Types.ObjectId(counterShift) })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    expect(last).toMatchObject({
      type: "withdraw",
      reason: "change",
      amount: 500,
    });

    // 小金庫:−3,000(開班)+1,000(投庫)−500(出庫)= −2,500(日結前從 0 起算)
    const board = await ok<{
      lotteryStoreBoard: { item: { vaultExpected: number } };
    }>(wang, BOARD, { orgId: String(xinyi) });
    expect(board.lotteryStoreBoard.item.vaultExpected).toBe(-2500);
  });

  it("同一班同時兩筆投庫,合計超過應有 → 只有一筆成功", async () => {
    const results = await Promise.all(
      [1500, 1500].map((amount) =>
        gql(wang, DEPOSIT, { input: { shiftId: counterShift, amount } }),
      ),
    );
    expect(
      results.filter((result) => result.errors === undefined),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.errors !== undefined)?.errors?.[0]
        ?.extensions,
    ).toMatchObject({ reason: "AMOUNT_EXCEEDS_DRAWER" });
  });

  it("收付與即時現金帳的登記:開著的班、各收銀點抽屜應有", async () => {
    const shift = await openShiftOf(tenant, counter);
    expect(String(shift?.shiftId)).toBe(counterShift);
    expect(await openShiftOf(tenant, restockDesk)).toBeNull();
    const drawers = await openDrawersOf(await operatorOf(wang), xinyi);
    expect(
      drawers.map((drawer) => [drawer.cashPointName, drawer.expected]),
    ).toEqual([
      ["店內櫃台", 1000],
      ["店外攤位", 0],
      ["彩券機旁", 0],
    ]);
  });

  it("收銀點停用守門:有開著的班、或檯面上還有未售的張 → 不能停用", async () => {
    expect(await isCashPointDeactivationBlocked(tenant, counter)).toBe(true);
    expect(await isCashPointDeactivationBlocked(tenant, restockDesk)).toBe(
      false,
    );
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertOne({
      orgId: xinyi,
      tenantId: tenant,
      bookId: new Types.ObjectId(),
      gameId: new Types.ObjectId(),
      bookNo: "0000001",
      ticketNo: "001",
      ticketKey: "9999-0000001-001",
      status: "unsold",
      location: { kind: "counter", cashPointId: restockDesk },
      lockedBy: null,
      responsibleOrgId: null,
      unitCost: 80,
      soldAt: null,
      soldBy: null,
      soldSource: null,
      version: 1,
      moduleKey: "inventory",
      ...base(),
    });
    expect(await isCashPointDeactivationBlocked(tenant, restockDesk)).toBe(
      true,
    );
  });

  it("看板卡片:檯面上的本(剩餘 / 總張數、今日售出、剩很少)", async () => {
    now("2026-11-05", "18:00");
    const { insertedId: gameId } = await connection
      .collection(LOTTERY_GAMES_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        gameCode: "5198",
        name: "鼠來寶",
        unitPrice: 100,
        ticketsPerBook: 20,
        bookPrice: 2000,
        defaultRate: 0.9,
        color: "blue",
        status: "on_sale",
        moduleKey: "master-data",
        ...base(),
      });
    const { insertedId: bookId } = await connection
      .collection(LOTTERY_BOOKS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        gameId,
        gameCode: "5198",
        bookNo: "0088102",
        bookKey: "5198-0088102",
        holderOrgIds: [xinyi],
        moduleKey: "inventory",
        ...base(),
      });
    await connection.collection(LOTTERY_TICKETS_COLLECTION).insertMany(
      Array.from({ length: 20 }, (_, index) => {
        let status = "unsold";
        if (index < 18) {
          status = "sold";
        }
        return {
          orgId: xinyi,
          tenantId: tenant,
          bookId,
          gameId,
          bookNo: "0088102",
          ticketNo: String(index + 1).padStart(3, "0"),
          ticketKey: `5198-0088102-${String(index + 1).padStart(3, "0")}`,
          status,
          location: { kind: "counter", cashPointId: counter },
          lockedBy: null,
          responsibleOrgId: null,
          unitCost: 90,
          // 前 3 張是昨天賣的
          soldAt: status === "sold" ? taipei(soldDayOf(index), "12:00") : null,
          soldBy: null,
          soldSource: status === "sold" ? "scan" : null,
          version: 1,
          moduleKey: "inventory",
          ...base(),
        };
      }),
    );
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: {
            name: string;
            books: Record<string, unknown>[];
          }[];
        };
      };
    }>(wang, BOARD, { orgId: String(xinyi) });
    const books = data.lotteryStoreBoard.item.cashPoints.find(
      (point) => point.name === "店內櫃台",
    )?.books;
    expect(books).toEqual([
      {
        bookNo: "0088102",
        gameName: "鼠來寶",
        color: "blue",
        unitPrice: 100,
        remaining: 2,
        total: 20,
        soldToday: 15,
        isLowStock: true,
      },
    ]);
  });

  it("交班結帳送出後(班已結束):改對應排班 → SHIFT_CLOSED;投庫 → SHIFT_CLOSED", async () => {
    await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .updateOne(
        { _id: new Types.ObjectId(stallShift) },
        { $set: { closedAt: new Date() } },
      );
    expect(
      await errorOf(wang, REASSIGN, {
        input: {
          shiftId: stallShift,
          temporaryCover: true,
          reasonKey: "wrong-entry-at-open",
        },
      }),
    ).toMatchObject({ reason: "SHIFT_CLOSED" });
    expect(
      await errorOf(wang, DEPOSIT, {
        input: { shiftId: stallShift, amount: 1 },
      }),
    ).toMatchObject({ reason: "SHIFT_CLOSED" });
    const info = await ok<{ lotteryShiftInfo: { item: InfoRow } }>(wang, INFO, {
      id: stallShift,
    });
    expect(info.lotteryShiftInfo.item).toMatchObject({
      closed: true,
      canReassign: false,
      entryOptions: [],
    });
  });

  it("同一人同時在兩家店開班(兩個收銀點同時送出)→ 只有一個成功,另一個 SHIFT_IN_OTHER_STORE", async () => {
    now("2026-11-05", "19:00");
    const zhao = await storeUser(
      [xinyi, banqiao],
      [S.view, S.openShift],
      "趙小龍",
    );
    const results = await Promise.all(
      [restockDesk, counterB].map((cashPointId) =>
        gql(zhao, OPEN, {
          input: { cashPointId: String(cashPointId), temporaryCover: true },
        }),
      ),
    );
    expect(
      results.filter((result) => result.errors === undefined),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.errors !== undefined)?.errors?.[0]
        ?.extensions,
    ).toMatchObject({ reason: "SHIFT_IN_OTHER_STORE" });
    expect(
      await connection
        .collection(LOTTERY_SHIFTS_COLLECTION)
        .countDocuments({ openedBy: zhao.userId, closedAt: null }),
    ).toBe(1);
  });
});
