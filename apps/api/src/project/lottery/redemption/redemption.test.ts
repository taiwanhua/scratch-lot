import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Connection, type Model, Types } from "mongoose";

import { STORE_PERMISSIONS as S } from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  type AuthTestApp,
  type GraphqlResult,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg, createUser } from "../../../auth/test-support/fixtures";
import { OrgsRepository } from "../../../database/database.module";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import { PASSWORD, login } from "../../../fields/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";
import { LOTTERY_CASH_POINTS_COLLECTION } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { LotteryRedemption } from "../../database/lottery-redemptions/lottery-redemption.schema";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { LOTTERY_SHIFTS_COLLECTION } from "../../database/lottery-store/lottery-shift.schema";
import { seedReasonCategory } from "../test-support/master-data-fixtures";
import { RedemptionPurchaseLink } from "./redemption-purchase-link";
import { redemptionPostCloseNet } from "./redemption-registrations";

// ---- GraphQL ----

const ITEM = /* GraphQL */ `
  id
  ticketLabel
  prizeAmount
  status
  isOwnStore
  replacesId
  isPostClose
  revokeReason
  revokeReasonKey
  revokeMode
  revokeBlockedBySent
  cashPoint { name }
  shift { id closed }
  redeemedBy { name }
`;

const BOARD = /* GraphQL */ `
  query Board($orgId: ID!) {
    lotteryStoreBoard(orgId: $orgId) {
      item {
        cashPoints {
          id
          shift {
            id
            expectedCash
          }
        }
      }
    }
  }
`;

const PREVIEW = /* GraphQL */ `
  query Preview($input: LotteryRedemptionPreviewInput!) {
    lotteryRedemptionPreview(input: $input) {
      item {
        gameCode
        gameName
        bookNo
        ticketNo
        ticketLabel
        isOwnStore
        existing {
          cashPointName
        }
      }
    }
  }
`;

const REDEEM = /* GraphQL */ `
  mutation Redeem($input: RedeemLotteryTicketInput!) {
    redeemLotteryTicket(input: $input) { item { ${ITEM} } }
  }
`;

const REVOKE = /* GraphQL */ `
  mutation Revoke($input: RevokeLotteryRedemptionInput!) {
    revokeLotteryRedemption(input: $input) { item { ${ITEM} } }
  }
`;

const REPLACE = /* GraphQL */ `
  mutation Replace($input: ReplaceLotteryRedemptionInput!) {
    replaceLotteryRedemption(input: $input) {
      revoked { ${ITEM} }
      item { ${ITEM} }
    }
  }
`;

const RECENT = /* GraphQL */ `
  query Recent($shiftId: ID!) {
    lotteryRecentRedemptions(shiftId: $shiftId) { ${ITEM} }
  }
`;

const DETAIL = /* GraphQL */ `
  query Detail($id: ID!) {
    lotteryRedemption(id: $id) { item { ${ITEM} } }
  }
`;

const LIST = /* GraphQL */ `
  query List($input: LotteryRedemptionsInput!) {
    lotteryRedemptions(input: $input) { total items { ${ITEM} } }
  }
`;

interface Row {
  id: string;
  ticketLabel: string;
  prizeAmount: number;
  status: string;
  isOwnStore: boolean;
  replacesId: string | null;
  isPostClose: boolean;
  revokeReason: string | null;
  revokeReasonKey: string | null;
  revokeMode: string | null;
  revokeBlockedBySent: boolean;
  cashPoint: { name: string };
  shift: { id: string; closed: boolean };
  redeemedBy: { name: string };
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

/** 背面編號:遊戲 5164、本號 056527、張號。 */
const back = (ticketNo: string, gameCode = "5164", bookNo = "056527") =>
  `${gameCode}-1-${bookNo}-${ticketNo}-0-6`;

/**
 * 兌獎(規格 6.5、6.12、第 17 章第 4、5、7 題):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 班次直接寫進資料庫(期初 5,000);「已結帳」的班 = 寫入 `closedAt`。
 *
 * 組織樹:root ─ 租戶甲 ── 信義店(店內櫃台、店外攤位)
 */
describe("兌獎(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let connection: Connection;
  let tenant: Types.ObjectId;
  let xinyi: Types.ObjectId;
  let counter: Types.ObjectId;
  let stall: Types.ObjectId;

  /** 店員:看板、兌獎 */
  let clerk: StoreUser;
  /** 另一位店員:看板、兌獎 */
  let clerk2: StoreUser;
  /** 店長:看板、編輯、兌獎、撤銷兌獎 */
  let manager: StoreUser;
  /** 只能看 */
  let viewer: StoreUser;

  let sequence = 0;

  const gql = (
    user: StoreUser,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphqlResult> =>
    api.graphql(query, variables, { accessToken: user.token });

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

  async function storeUser(
    permissionKeys: readonly string[],
    name: string,
  ): Promise<StoreUser> {
    sequence += 1;
    const account = `redeem-user-${String(sequence)}`;
    const userId = await createUser(connection, {
      account,
      password: PASSWORD,
      orgIds: [xinyi],
    });
    await connection
      .collection("users")
      .updateOne({ _id: userId }, { $set: { name } });
    await createRole(api.app, connection, {
      name: `兌獎角色:${account}`,
      ownerOrgId: xinyi,
      moduleKeys: ["store"],
      permissionKeys: [...permissionKeys],
      assignTo: [userId],
    });
    return { userId, token: await login(api, account) };
  }

  async function cashPoint(
    orgId: Types.ObjectId,
    name: string,
    order: number,
  ): Promise<Types.ObjectId> {
    const { insertedId } = await connection
      .collection(LOTTERY_CASH_POINTS_COLLECTION)
      .insertOne({
        orgId,
        tenantId: tenant,
        positionKey: `p-${String(order)}`,
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

  /** 開著的班(期初 5,000)。 */
  async function openShift(
    cashPointId: Types.ObjectId,
    openedBy: StoreUser,
  ): Promise<string> {
    const { insertedId } = await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .insertOne({
        orgId: xinyi,
        tenantId: tenant,
        cashPointId,
        openedBy: openedBy.userId,
        openedAt: new Date(),
        openingFloat: 5000,
        openingFloatSource: "handover",
        previousShiftId: null,
        openingMovementId: null,
        scheduleEntryId: null,
        scheduleTaskSnapshot: null,
        positionMismatch: null,
        closedAt: null,
        checkoutId: null,
        drawerVersion: 0,
        moduleKey: "store",
        ...base(),
      });
    return String(insertedId);
  }

  async function closeShift(shiftId: string): Promise<void> {
    await connection
      .collection(LOTTERY_SHIFTS_COLLECTION)
      .updateOne(
        { _id: new Types.ObjectId(shiftId) },
        { $set: { closedAt: new Date() } },
      );
  }

  async function expectedOf(shiftId: string): Promise<number> {
    const data = await ok<{
      lotteryStoreBoard: {
        item: {
          cashPoints: { shift: { id: string; expectedCash: number } | null }[];
        };
      };
    }>(manager, BOARD, { orgId: String(xinyi) });
    const shift = data.lotteryStoreBoard.item.cashPoints.find(
      (point) => point.shift?.id === shiftId,
    )?.shift;
    if (shift == null) {
      throw new Error(`班 ${shiftId} 不在看板上`);
    }
    return shift.expectedCash;
  }

  async function redeem(
    user: StoreUser,
    shiftId: string,
    code: string,
    prizeAmount: number,
  ): Promise<Row> {
    const data = await ok<{ redeemLotteryTicket: { item: Row } }>(
      user,
      REDEEM,
      { input: { shiftId, code, prizeAmount } },
    );
    return data.redeemLotteryTicket.item;
  }

  async function detail(user: StoreUser, id: string): Promise<Row> {
    const data = await ok<{ lotteryRedemption: { item: Row } }>(user, DETAIL, {
      id,
    });
    return data.lotteryRedemption.item;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-redemption");
    connection = api.connection;
    await api.app
      .get<Model<LotteryRedemption>>(getModelToken(LotteryRedemption.name))
      .init();
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
      LOTTERY_FIELD_CATEGORY_KEYS.redemptionRevokeReason,
      [
        { value: "entry-error", label: "登記錯誤" },
        { value: "other", label: "其他" },
      ],
    );
    tenant = await createOrg(connection, {
      name: "租戶甲",
      settings: { visibility: "subtree" },
    });
    xinyi = await createOrg(connection, { name: "信義店", parentId: tenant });
    counter = await cashPoint(xinyi, "店內櫃台", 1);
    stall = await cashPoint(xinyi, "店外攤位", 2);

    // 遊戲 5164 與信義店持有的張 #001–#040(本店的刮刮樂)
    const { insertedId: gameId } = await connection
      .collection("lottery_games")
      .insertOne({
        gameCode: "5164",
        name: "發大財",
        status: "on_sale",
        unitPrice: 200,
        ticketsPerBook: 100,
        bookPrice: 20_000,
        defaultRate: 92,
        color: null,
        orgId: tenant,
        tenantId: tenant,
        shareOrgs: [{ orgId: tenant, includeDescendants: true }],
        moduleKey: "master-data",
        ...base(),
      });
    const bookId = new Types.ObjectId();
    await connection.collection("lottery_tickets").insertMany(
      Array.from({ length: 40 }, (_, index) => {
        const ticketNo = String(index + 1).padStart(3, "0");
        return {
          orgId: xinyi,
          tenantId: tenant,
          bookId,
          gameId,
          bookNo: "0056527",
          ticketNo,
          ticketKey: `5164-0056527-${ticketNo}`,
          status: "sold",
          location: { kind: "sold", cashPointId: null },
          lockedBy: null,
          responsibleOrgId: null,
          unitCost: 184,
          soldAt: new Date(),
          soldBy: null,
          soldSource: "scan",
          version: 1,
          moduleKey: "inventory",
          ...base(),
        };
      }),
    );

    clerk = await storeUser([S.view, S.redeem], "王小明");
    clerk2 = await storeUser([S.view, S.redeem], "林小美");
    manager = await storeUser(
      [S.view, S.edit, S.redeem, S.undoRedeem],
      "陳店長",
    );
    viewer = await storeUser([S.view], "路人");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  });

  it("預覽:背面編號 → 遊戲、本號、張號、本店的刮刮樂;正面編號用本店的張找到遊戲", async () => {
    const data = await ok<{
      lotteryRedemptionPreview: { item: Record<string, unknown> };
    }>(clerk, PREVIEW, {
      input: { orgId: String(xinyi), code: back("012") },
    });
    expect(data.lotteryRedemptionPreview.item).toEqual({
      gameCode: "5164",
      gameName: "發大財",
      bookNo: "0056527",
      ticketNo: "012",
      ticketLabel: "5164-056527-012",
      isOwnStore: true,
      existing: null,
    });
    const front = await ok<{
      lotteryRedemptionPreview: { item: { gameCode: string } };
    }>(clerk, PREVIEW, { input: { orgId: String(xinyi), code: "056527012" } });
    expect(front.lotteryRedemptionPreview.item.gameCode).toBe("5164");
    // 不是本店的:正面編號找不到遊戲 → 請刷背面編號;背面編號照樣可以兌,ticketId = null
    expect(
      await errorOf(clerk, PREVIEW, {
        input: { orgId: String(xinyi), code: "099999012" },
      }),
    ).toMatchObject({ reason: "REDEMPTION_CODE_NEEDS_BACK" });
    const other = await ok<{
      lotteryRedemptionPreview: { item: { isOwnStore: boolean } };
    }>(clerk, PREVIEW, {
      input: { orgId: String(xinyi), code: back("012", "5164", "099999") },
    });
    expect(other.lotteryRedemptionPreview.item.isOwnStore).toBe(false);
  });

  it("第 17 章第 4 題:兌獎打錯當下撤銷再重登 —— 4,500 → 5,000 → 4,500;#031 之後可以再登記", async () => {
    const shiftId = await openShift(counter, clerk);
    const wrong = await redeem(clerk, shiftId, back("031"), 500);
    expect(wrong).toMatchObject({
      status: "in_store",
      isOwnStore: true,
      revokeMode: "self",
      cashPoint: { name: "店內櫃台" },
    });
    expect(await expectedOf(shiftId)).toBe(4500);

    const revoked = await ok<{ revokeLotteryRedemption: { item: Row } }>(
      clerk,
      REVOKE,
      { input: { id: wrong.id } },
    );
    expect(revoked.revokeLotteryRedemption.item).toMatchObject({
      status: "revoked",
      revokeReasonKey: "immediate",
      revokeMode: null,
    });
    expect(await expectedOf(shiftId)).toBe(5000);

    const right = await redeem(clerk, shiftId, back("032"), 500);
    expect(right.status).toBe("in_store");
    expect(await expectedOf(shiftId)).toBe(4500);
    expect(await detail(clerk, wrong.id)).toHaveProperty("status", "revoked");

    // 撤銷後同一張可以再登記(部分唯一索引只限未撤銷的)
    const again = await redeem(clerk, shiftId, back("031"), 200);
    expect(again.status).toBe("in_store");
    expect(await expectedOf(shiftId)).toBe(4300);
    await closeShift(shiftId);
  });

  it("同一張未撤銷的兌兩次 → 擋下(帶第一次的收銀點);別家店兌過也算;撤銷後可再登記", async () => {
    const shiftId = await openShift(stall, clerk2);
    const first = await redeem(clerk2, shiftId, back("020"), 200);
    expect(
      await errorOf(clerk2, REDEEM, {
        input: { shiftId, code: back("020"), prizeAmount: 200 },
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "REDEMPTION_DUPLICATE",
      cashPointName: "店外攤位",
    });
    // 預覽也看得到「已兌過」
    const preview = await ok<{
      lotteryRedemptionPreview: {
        item: { existing: { cashPointName: string } | null };
      };
    }>(clerk2, PREVIEW, { input: { orgId: String(xinyi), code: back("020") } });
    expect(preview.lotteryRedemptionPreview.item.existing).toEqual({
      cashPointName: "店外攤位",
    });
    // 同時兩個請求兌同一張:只有一個成功
    const results = await Promise.all([
      gql(clerk2, REDEEM, {
        input: { shiftId, code: back("021"), prizeAmount: 200 },
      }),
      gql(clerk2, REDEEM, {
        input: { shiftId, code: back("021"), prizeAmount: 200 },
      }),
    ]);
    expect(
      results.filter((result) => result.errors === undefined),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.errors !== undefined)?.errors?.[0]
        ?.extensions,
    ).toMatchObject({ reason: "REDEMPTION_DUPLICATE" });

    await ok(clerk2, REVOKE, { input: { id: first.id } });
    const again = await redeem(clerk2, shiftId, back("020"), 200);
    expect(again.status).toBe("in_store");
    await closeShift(shiftId);
  });

  it("單張超過 5,000 擋下;超過抽屜應有擋下;班已結帳不能兌獎;沒有 store.redeem 不能兌獎", async () => {
    const shiftId = await openShift(counter, clerk);
    expect(
      await errorOf(clerk, REDEEM, {
        input: { shiftId, code: back("001"), prizeAmount: 5001 },
      }),
    ).toMatchObject({ reason: "REDEMPTION_OVER_LIMIT" });
    await redeem(clerk, shiftId, back("002"), 4000);
    expect(
      await errorOf(clerk, REDEEM, {
        input: { shiftId, code: back("003"), prizeAmount: 1001 },
      }),
    ).toMatchObject({ reason: "AMOUNT_EXCEEDS_DRAWER", expected: 1000 });
    expect(
      await errorOf(viewer, REDEEM, {
        input: { shiftId, code: back("003"), prizeAmount: 100 },
      }),
    ).toMatchObject({ code: "FORBIDDEN" });
    await closeShift(shiftId);
    expect(
      await errorOf(clerk, REDEEM, {
        input: { shiftId, code: back("003"), prizeAmount: 100 },
      }),
    ).toMatchObject({ reason: "SHIFT_CLOSED" });
  });

  it("[最近兌獎] 只列自己在這一班登記的(含已撤銷);兌獎紀錄分頁依狀態 / 登記人篩選", async () => {
    const shiftId = await openShift(counter, clerk);
    const mine = await redeem(clerk, shiftId, back("004"), 100);
    const revoked = await redeem(clerk, shiftId, back("005"), 100);
    await ok(clerk, REVOKE, { input: { id: revoked.id } });
    await redeem(clerk2, shiftId, back("006"), 100);
    const recent = await ok<{ lotteryRecentRedemptions: Row[] }>(
      clerk,
      RECENT,
      { shiftId },
    );
    expect(
      recent.lotteryRecentRedemptions.map((row) => [row.id, row.status]),
    ).toEqual([
      [revoked.id, "revoked"],
      [mine.id, "in_store"],
    ]);

    const list = await ok<{
      lotteryRedemptions: { total: number; items: Row[] };
    }>(manager, LIST, {
      input: {
        orgId: String(xinyi),
        status: "revoked",
        redeemedBy: String(clerk.userId),
      },
    });
    expect(list.lotteryRedemptions.items.map((row) => row.id)).toContain(
      revoked.id,
    );
    expect(
      list.lotteryRedemptions.items.every(
        (row) => row.status === "revoked" && row.redeemedBy.name === "王小明",
      ),
    ).toBe(true);
    await closeShift(shiftId);
  });

  it("第 17 章第 5 題:交班後店長 [撤銷並重新登記] —— 原紀錄已撤銷、新紀錄 replacesId、事後更正 +1,800", async () => {
    const shiftId = await openShift(counter, clerk);
    const wrong = await redeem(clerk, shiftId, back("007"), 2000);
    expect(await expectedOf(shiftId)).toBe(3000);
    await closeShift(shiftId);

    // 店員:那一班已結帳 → 沒有撤銷按鈕、api 拒絕
    expect(await detail(clerk, wrong.id)).toHaveProperty("revokeMode", null);
    expect(
      await errorOf(clerk, REVOKE, { input: { id: wrong.id } }),
    ).toMatchObject({ code: "FORBIDDEN" });
    // 店長:要撤銷原因
    expect(await detail(manager, wrong.id)).toHaveProperty(
      "revokeMode",
      "manager",
    );
    expect(
      await errorOf(manager, REPLACE, {
        input: { id: wrong.id, code: back("007"), prizeAmount: 200 },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["reasonKey"] });

    const data = await ok<{
      replaceLotteryRedemption: { revoked: Row; item: Row };
    }>(manager, REPLACE, {
      input: {
        id: wrong.id,
        reasonKey: "entry-error",
        reasonNote: "200 元登記成 2,000",
        code: back("007"),
        prizeAmount: 200,
      },
    });
    const { revoked, item } = data.replaceLotteryRedemption;
    expect(revoked).toMatchObject({
      status: "revoked",
      revokeReason: "登記錯誤",
    });
    expect(item).toMatchObject({
      status: "in_store",
      prizeAmount: 200,
      replacesId: wrong.id,
      isPostClose: true,
      shift: { id: shiftId, closed: true },
      redeemedBy: { name: "陳店長" },
    });

    const reader = await tenantBoundaryContext(
      api.app.get(OrgsRepository),
      null,
      tenant,
    );
    expect(
      await redemptionPostCloseNet(
        api.app.get(LotteryRedemptionsRepository),
        reader,
        new Types.ObjectId(shiftId),
      ),
    ).toBe(1800);
    const audit = await connection
      .collection("audit_logs")
      .findOne({ targetId: new Types.ObjectId(wrong.id) });
    expect(audit).toMatchObject({ action: "lottery-redemption.revoke" });
  });

  it("別人登記、班還開著:店員看不到撤銷按鈕;店長要原因,撤銷後應有增加(不是事後更正)", async () => {
    const shiftId = await openShift(counter, clerk);
    const row = await redeem(clerk, shiftId, back("008"), 1000);
    expect(await expectedOf(shiftId)).toBe(4000);
    expect(await detail(clerk2, row.id)).toHaveProperty("revokeMode", null);
    expect(
      await errorOf(clerk2, REVOKE, { input: { id: row.id } }),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await errorOf(manager, REVOKE, { input: { id: row.id } }),
    ).toMatchObject({ fields: ["reasonKey"] });
    await ok(manager, REVOKE, {
      input: { id: row.id, reasonKey: "other", reasonNote: "客人拿錯" },
    });
    expect(await expectedOf(shiftId)).toBe(5000);
    await closeShift(shiftId);
  });

  it("第 17 章第 7 題:已送兌不能撤銷(按鈕停用、api 拒絕);撤回進貨單後回到店內持有,撤銷 4,500 → 5,000", async () => {
    const xinyiShift = await openShift(counter, clerk);
    const row = await redeem(
      clerk,
      xinyiShift,
      back("031", "5164", "077777"),
      500,
    );
    expect(await expectedOf(xinyiShift)).toBe(4500);
    const link = api.app.get(RedemptionPurchaseLink);
    const purchase = {
      tenantId: tenant,
      submissionId: new Types.ObjectId(),
    };
    await link.markSent(undefined, purchase, [
      { rowId: null, redemptionId: row.id, prizeAmount: 500 },
    ]);
    expect(await detail(clerk, row.id)).toMatchObject({
      status: "sent",
      revokeMode: "self",
      revokeBlockedBySent: true,
    });
    expect(
      await errorOf(clerk, REVOKE, { input: { id: row.id } }),
    ).toMatchObject({ reason: "REDEMPTION_SENT" });
    expect(
      await errorOf(manager, REVOKE, {
        input: { id: row.id, reasonKey: "entry-error" },
      }),
    ).toMatchObject({ reason: "REDEMPTION_SENT" });

    await link.release(undefined, purchase);
    expect(await detail(clerk, row.id)).toHaveProperty("status", "in_store");
    await ok(clerk, REVOKE, { input: { id: row.id } });
    expect(await expectedOf(xinyiShift)).toBe(5000);
    await closeShift(xinyiShift);
  });
});
