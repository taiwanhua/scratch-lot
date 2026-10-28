import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { getModelToken } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";

import { MASTER_DATA_PERMISSIONS as P } from "@repo/domain/project/lottery-master-data";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../../../auth/test-support/auth-app";
import { createOrg } from "../../../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../../../database/test-support/mongo-connection";
import {
  LOTTERY_GAMES_COLLECTION,
  LotteryGame,
  MASTER_DATA_MODULE_KEY,
} from "../../database/lottery-games/lottery-game.schema";
import {
  GAME_MODULES,
  createMasterDataOperator,
  errorOf,
  ok,
  seedMasterDataAuthorization,
} from "../test-support/master-data-fixtures";
import { registerGameUsageChecker } from "./game-usage";

const GAME_FIELDS = /* GraphQL */ `
  fragment TestLotteryGameFields on LotteryGame {
    id
    gameCode
    name
    unitPrice
    ticketsPerBook
    bookPrice
    defaultRate
    color
    status
    launchedAt
    discontinuedAt
    claimDeadline
    note
    inUse
    abilities {
      canEdit
      canDelete
    }
  }
`;

const LIST = /* GraphQL */ `
  ${GAME_FIELDS}
  query TestLotteryGames($input: LotteryGamesInput!) {
    lotteryGames(input: $input) {
      items {
        ...TestLotteryGameFields
      }
      totalCount
    }
  }
`;

const ONE = /* GraphQL */ `
  ${GAME_FIELDS}
  query TestLotteryGame($id: ID!) {
    lotteryGame(id: $id) {
      item {
        ...TestLotteryGameFields
      }
    }
  }
`;

const CREATE = /* GraphQL */ `
  ${GAME_FIELDS}
  mutation TestCreateLotteryGame($input: CreateLotteryGameInput!) {
    createLotteryGame(input: $input) {
      item {
        ...TestLotteryGameFields
      }
    }
  }
`;

const UPDATE = /* GraphQL */ `
  ${GAME_FIELDS}
  mutation TestUpdateLotteryGame($input: UpdateLotteryGameInput!) {
    updateLotteryGame(input: $input) {
      item {
        ...TestLotteryGameFields
      }
    }
  }
`;

const DELETE = /* GraphQL */ `
  mutation TestDeleteLotteryGame($input: DeleteLotteryGameInput!) {
    deleteLotteryGame(input: $input) {
      success
      deletedId
    }
  }
`;

interface GameRow {
  id: string;
  gameCode: string;
  name: string;
  unitPrice: number;
  ticketsPerBook: number;
  bookPrice: number;
  defaultRate: number;
  color: string | null;
  status: string;
  launchedAt: string | null;
  discontinuedAt: string | null;
  claimDeadline: string | null;
  note: string | null;
  inUse: boolean;
  abilities: { canEdit: boolean; canDelete: boolean };
}

interface ListData {
  lotteryGames: { items: GameRow[]; totalCount: number };
}

interface OneData {
  lotteryGame: { item: GameRow };
}

interface CreateData {
  createLotteryGame: { item: GameRow };
}

interface UpdateData {
  updateLotteryGame: { item: GameRow };
}

const ALL_GAME_PERMISSIONS = [P.gamesCreate, P.gamesEdit, P.gamesDelete];

let codeSequence = 1000;

function nextCode(): string {
  codeSequence += 1;
  return String(codeSequence);
}

function gameInput(overrides: Record<string, unknown> = {}) {
  return {
    gameCode: nextCode(),
    name: "金好運",
    unitPrice: 100,
    ticketsPerBook: 100,
    defaultRate: 92,
    // 租戶時區(預設 Asia/Taipei)2026-12-15 00:00
    claimDeadline: "2026-12-14T16:00:00.000Z",
    ...overrides,
  };
}

/**
 * 遊戲(專案規格 5.1):打真的 GraphQL 端點、對真 MongoDB(TEST-07)。
 * 組織樹:root ─┬─ 租戶甲 ─ 甲分店   └─ 租戶乙。遊戲是租戶共用的主檔,掛在租戶頂層。
 */
describe("檔案管理 → 遊戲(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  let tenantA: Types.ObjectId;
  /** 租戶甲總部:三筆權限全有。 */
  let managerA: string;
  /** 甲分店:只綁遊戲分頁,沒有任何寫入權限。 */
  let branchViewerA: string;
  /** 租戶乙總部:三筆權限全有。 */
  let managerB: string;
  /** 租戶甲:沒綁遊戲分頁。 */
  let outsiderA: string;
  /** 甲分店的店長:三筆權限全有(看得到總部建的,但改不了;自己建的歸甲分店)。 */
  let branchManagerA: string;

  /** app 裡的遊戲 model(等索引建好用)。 */
  function gameModel(): Model<LotteryGame> {
    return api.app.get<Model<LotteryGame>>(getModelToken(LotteryGame.name));
  }

  async function createGame(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GameRow> {
    const data = await ok<CreateData>(api, token, CREATE, {
      input: gameInput(overrides),
    });
    return data.createLotteryGame.item;
  }

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-lottery-games");
    await seedMasterDataAuthorization(api.connection);
    tenantA = await createOrg(api.connection, { name: "租戶甲" });
    const branchA = await createOrg(api.connection, {
      name: "甲分店",
      parentId: tenantA,
    });
    const tenantB = await createOrg(api.connection, { name: "租戶乙" });
    managerA = await createMasterDataOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys: GAME_MODULES,
      permissionKeys: ALL_GAME_PERMISSIONS,
    });
    branchViewerA = await createMasterDataOperator(api, api.connection, {
      orgId: branchA,
      ownerOrgId: tenantA,
      moduleKeys: GAME_MODULES,
      permissionKeys: [],
    });
    managerB = await createMasterDataOperator(api, api.connection, {
      orgId: tenantB,
      moduleKeys: GAME_MODULES,
      permissionKeys: ALL_GAME_PERMISSIONS,
    });
    outsiderA = await createMasterDataOperator(api, api.connection, {
      orgId: tenantA,
      moduleKeys: [],
      permissionKeys: [],
    });
    branchManagerA = await createMasterDataOperator(api, api.connection, {
      orgId: branchA,
      ownerOrgId: tenantA,
      moduleKeys: GAME_MODULES,
      permissionKeys: ALL_GAME_PERMISSIONS,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("面額 / 張數:每個預設面額一列 + 非標準一列(都存得進去,整本金額由 api 算)", () => {
    it.each([
      [100, 100, 10_000],
      [200, 100, 20_000],
      [300, 100, 30_000],
      [500, 50, 25_000],
      [1000, 25, 25_000],
      [2000, 18, 36_000],
      [400, 40, 16_000],
    ])(
      "單張 %i × %i 張 → 整本 %i",
      async (unitPrice, ticketsPerBook, bookPrice) => {
        const game = await createGame(managerA, { unitPrice, ticketsPerBook });
        expect(game).toMatchObject({
          unitPrice,
          ticketsPerBook,
          bookPrice,
          status: "on_sale",
          inUse: false,
        });
      },
    );
  });

  describe("遊戲代號", () => {
    it.each(["520", "52011", "52a1", " "])(
      "%p 不是 4 碼數字 → VALIDATION_FAILED(gameCode)",
      async (gameCode) => {
        const extensions = await errorOf(api, managerA, CREATE, {
          input: gameInput({ gameCode }),
        });
        expect(extensions).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["gameCode"],
        });
      },
    );

    it("租戶內重複 → VALIDATION_FAILED(GAME_CODE_DUPLICATE);別的租戶可以用同一個代號", async () => {
      const game = await createGame(managerA);
      expect(
        await errorOf(api, managerA, CREATE, {
          input: gameInput({ gameCode: game.gameCode }),
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        fields: ["gameCode"],
        reason: "GAME_CODE_DUPLICATE",
      });
      const other = await createGame(managerB, { gameCode: game.gameCode });
      expect(other.gameCode).toBe(game.gameCode);
    });

    it("同時送出兩筆相同代號:只成功一筆,另一筆 VALIDATION_FAILED(GAME_CODE_DUPLICATE)", async () => {
      // 先等唯一索引建好(先例 `database/scheduled-job-runs.store.ts`),否則兩筆可能都寫進去
      await gameModel().init();
      const gameCode = nextCode();
      const results = await Promise.all(
        [1, 2].map(() =>
          api.graphql<CreateData>(
            CREATE,
            { input: gameInput({ gameCode }) },
            { accessToken: managerA },
          ),
        ),
      );
      const succeeded = results.filter((result) => result.errors === undefined);
      const failed = results.flatMap((result) => result.errors ?? []);
      expect(succeeded).toHaveLength(1);
      expect(failed.map((error) => error.extensions)).toEqual([
        expect.objectContaining({
          code: "VALIDATION_FAILED",
          fields: ["gameCode"],
          reason: "GAME_CODE_DUPLICATE",
        }),
      ]);
      const list = await ok<ListData>(api, managerA, LIST, {
        input: { keyword: gameCode, status: null },
      });
      expect(list.lotteryGames.totalCount).toBe(1);
    });

    it("索引本身:同租戶同代號直接寫第二筆 → E11000;已軟刪除的同代號可以並存", async () => {
      const model = gameModel();
      await model.init();
      const gameCode = nextCode();
      const raw = (deletedAt: Date | null) => {
        const now = new Date();
        return {
          gameCode,
          name: "索引測試",
          unitPrice: 100,
          ticketsPerBook: 100,
          bookPrice: 10_000,
          defaultRate: 90,
          color: null,
          status: "on_sale",
          orgId: tenantA,
          tenantId: tenantA,
          moduleKey: MASTER_DATA_MODULE_KEY,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
          deletedAt,
        };
      };
      const collection = api.connection.collection(LOTTERY_GAMES_COLLECTION);
      await collection.insertOne(raw(null));
      await expect(collection.insertOne(raw(null))).rejects.toMatchObject({
        code: 11_000,
      });
      await expect(
        collection.insertOne(raw(new Date())),
      ).resolves.toMatchObject({ acknowledged: true });
      expect(
        await collection.countDocuments({ tenantId: tenantA, gameCode }),
      ).toBe(2);
    });

    it("刪除後代號可以再用", async () => {
      const game = await createGame(managerA);
      await ok(api, managerA, DELETE, { input: { id: game.id } });
      const again = await createGame(managerA, { gameCode: game.gameCode });
      expect(again.gameCode).toBe(game.gameCode);
    });
  });

  it("單張金額要是 100 的倍數(使用者 10/28 定案):150、-100 → VALIDATION_FAILED unitPrice", async () => {
    for (const unitPrice of [150, -100]) {
      expect(
        await errorOf(api, managerA, CREATE, {
          input: gameInput({ unitPrice }),
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["unitPrice"] });
    }
  });

  it("其他欄位的邊界:名稱 30 字、張數 1–999、批購金額率 0–100 整數、顏色只收色票", async () => {
    expect(
      await errorOf(api, managerA, CREATE, {
        input: gameInput({
          name: "字".repeat(31),
          ticketsPerBook: 1000,
          defaultRate: 101,
          unitPrice: 0,
          color: "#ff0000",
        }),
      }),
    ).toMatchObject({
      code: "VALIDATION_FAILED",
      fields: ["name", "unitPrice", "ticketsPerBook", "defaultRate", "color"],
    });
    const game = await createGame(managerA, {
      name: "字".repeat(30),
      ticketsPerBook: 999,
      defaultRate: 0,
      color: "red",
    });
    expect(game).toMatchObject({ ticketsPerBook: 999, color: "red" });
  });

  describe("上市日 / 停售日由兌獎截止日推算(租戶時區的日曆日)", () => {
    it("新增:存推算值(停售 −3 個月、上市 −9 個月,月底取該月最後一天);兌獎截止日收斂成當天 00:00", async () => {
      // Asia/Taipei 2026-05-31 09:30 → 當天 00:00
      const game = await createGame(managerA, {
        claimDeadline: "2026-05-31T01:30:00.000Z",
      });
      expect(game).toMatchObject({
        claimDeadline: "2026-05-30T16:00:00.000Z",
        discontinuedAt: "2026-02-27T16:00:00.000Z",
        launchedAt: "2025-08-30T16:00:00.000Z",
      });
    });

    it("新增缺兌獎截止日 → VALIDATION_FAILED(claimDeadline)", async () => {
      for (const claimDeadline of [undefined, null]) {
        expect(
          await errorOf(api, managerA, CREATE, {
            input: gameInput({ claimDeadline }),
          }),
        ).toMatchObject({
          code: "VALIDATION_FAILED",
          fields: ["claimDeadline"],
        });
      }
    });

    it("編輯:改兌獎截止日就重算;沒送或送 null = 不動", async () => {
      const game = await createGame(managerA);
      expect(game).toMatchObject({
        discontinuedAt: "2026-09-14T16:00:00.000Z",
        launchedAt: "2026-03-14T16:00:00.000Z",
      });
      const renamed = await ok<UpdateData>(api, managerA, UPDATE, {
        input: { id: game.id, name: "改名", claimDeadline: null },
      });
      expect(renamed.updateLotteryGame.item).toMatchObject({
        claimDeadline: game.claimDeadline,
        discontinuedAt: game.discontinuedAt,
        launchedAt: game.launchedAt,
      });
      // 跨年 + 閏年:2028-11-30 → 停售 2028-08-30、上市 2028-02-29
      const moved = await ok<UpdateData>(api, managerA, UPDATE, {
        input: { id: game.id, claimDeadline: "2028-11-29T16:00:00.000Z" },
      });
      expect(moved.updateLotteryGame.item).toMatchObject({
        claimDeadline: "2028-11-29T16:00:00.000Z",
        discontinuedAt: "2028-08-29T16:00:00.000Z",
        launchedAt: "2028-02-28T16:00:00.000Z",
      });
    });

    it("編輯沒有兌獎截止日的舊資料:沒補兌獎截止日 → VALIDATION_FAILED(claimDeadline)", async () => {
      const game = await createGame(managerA);
      await api.connection
        .collection(LOTTERY_GAMES_COLLECTION)
        .updateOne(
          { _id: new Types.ObjectId(game.id) },
          { $set: { claimDeadline: null } },
        );
      expect(
        await errorOf(api, managerA, UPDATE, {
          input: { id: game.id, name: "改名" },
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED", fields: ["claimDeadline"] });
    });
  });

  describe("範圍:遊戲是整個租戶共用的", () => {
    it("分店人員看得到租戶頂層的遊戲;別租戶看不到(NOT_FOUND)", async () => {
      const game = await createGame(managerA, { name: "分店也看得到" });
      const list = await ok<ListData>(api, branchViewerA, LIST, {
        input: { keyword: "分店也看得到" },
      });
      expect(list.lotteryGames.items.map((row) => row.id)).toEqual([game.id]);
      expect(await errorOf(api, managerB, ONE, { id: game.id })).toMatchObject({
        code: "NOT_FOUND",
      });
      expect(
        await errorOf(api, managerB, UPDATE, {
          input: { id: game.id, name: "改別人的" },
        }),
      ).toMatchObject({ code: "NOT_FOUND" });
    });

    it("共用給全部分店:店長看得到總部建的,但改不了、刪不了(abilities 都是 false、寫入 NOT_FOUND)", async () => {
      const game = await createGame(managerA, { name: "總部建的" });
      const viewed = await ok<OneData>(api, branchManagerA, ONE, {
        id: game.id,
      });
      expect(viewed.lotteryGame.item.abilities).toEqual({
        canEdit: false,
        canDelete: false,
      });
      expect(
        await errorOf(api, branchManagerA, UPDATE, {
          input: { id: game.id, name: "店長改總部的" },
        }),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(
        await errorOf(api, branchManagerA, DELETE, { input: { id: game.id } }),
      ).toMatchObject({ code: "NOT_FOUND" });
    });

    it("建立歸當前組織:店長建的歸甲分店,總部看得到但改不了;店長自己改得到", async () => {
      const game = await createGame(branchManagerA, { name: "店長建的" });
      const stored = await gameModel().collection.findOne({
        _id: new Types.ObjectId(game.id),
      });
      expect(String(stored?.orgId)).not.toBe(String(tenantA));
      expect(stored?.shareOrgs).toEqual([
        { orgId: tenantA, includeDescendants: true },
      ]);
      const seenByHq = await ok<OneData>(api, managerA, ONE, { id: game.id });
      expect(seenByHq.lotteryGame.item.abilities.canEdit).toBe(false);
      expect(
        await errorOf(api, managerA, UPDATE, {
          input: { id: game.id, name: "總部改店長的" },
        }),
      ).toMatchObject({ code: "NOT_FOUND" });
      const edited = await ok<UpdateData>(api, branchManagerA, UPDATE, {
        input: { id: game.id, name: "店長自己改" },
      });
      expect(edited.updateLotteryGame.item.name).toBe("店長自己改");
    });

    it("代號整個租戶唯一:店長不能用總部已用過的代號(GAME_CODE_DUPLICATE)", async () => {
      const game = await createGame(managerA, { name: "代號已占用" });
      expect(
        await errorOf(api, branchManagerA, CREATE, {
          input: gameInput({ gameCode: game.gameCode }),
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "GAME_CODE_DUPLICATE",
      });
    });

    it("別的租戶刪除 → NOT_FOUND,遊戲還在", async () => {
      const game = await createGame(managerA, { name: "別租戶刪不到" });
      expect(
        await errorOf(api, managerB, DELETE, { input: { id: game.id } }),
      ).toMatchObject({ code: "NOT_FOUND" });
      const viewed = await ok<OneData>(api, managerA, ONE, { id: game.id });
      expect(viewed.lotteryGame.item.id).toBe(game.id);
    });

    it("沒綁遊戲分頁 → 清單 FORBIDDEN", async () => {
      expect(await errorOf(api, outsiderA, LIST, { input: {} })).toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("篩選:狀態、面額、關鍵字(代號或名稱)", async () => {
      const onSale = await createGame(managerA, {
        name: "篩選販售中",
        unitPrice: 300,
        ticketsPerBook: 100,
      });
      const stopped = await createGame(managerA, {
        name: "篩選停售",
        unitPrice: 300,
        ticketsPerBook: 100,
        status: "discontinued",
      });
      const byStatus = await ok<ListData>(api, managerA, LIST, {
        input: { keyword: "篩選", status: "discontinued" },
      });
      expect(byStatus.lotteryGames.items.map((row) => row.id)).toEqual([
        stopped.id,
      ]);
      const byPrice = await ok<ListData>(api, managerA, LIST, {
        input: { keyword: "篩選", unitPrice: 300 },
      });
      expect(byPrice.lotteryGames.totalCount).toBe(2);
      const byCode = await ok<ListData>(api, managerA, LIST, {
        input: { keyword: onSale.gameCode },
      });
      expect(byCode.lotteryGames.items.map((row) => row.id)).toEqual([
        onSale.id,
      ]);
    });
  });

  describe("權限", () => {
    it("沒有 create / edit / delete → FORBIDDEN;abilities 依權限", async () => {
      const game = await createGame(managerA);
      expect(
        await errorOf(api, branchViewerA, CREATE, { input: gameInput() }),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await errorOf(api, branchViewerA, UPDATE, {
          input: { id: game.id, name: "x" },
        }),
      ).toMatchObject({ code: "FORBIDDEN" });
      expect(
        await errorOf(api, branchViewerA, DELETE, { input: { id: game.id } }),
      ).toMatchObject({ code: "FORBIDDEN" });
      const viewed = await ok<OneData>(api, branchViewerA, ONE, {
        id: game.id,
      });
      expect(viewed.lotteryGame.item.abilities).toEqual({
        canEdit: false,
        canDelete: false,
      });
      const managed = await ok<OneData>(api, managerA, ONE, { id: game.id });
      expect(managed.lotteryGame.item.abilities).toEqual({
        canEdit: true,
        canDelete: true,
      });
    });
  });

  describe("有庫存(任何引用檢查回 true)", () => {
    it("代號、面額、張數改不了(GAME_IN_USE),其他欄位照改;不能刪除;inUse / canDelete 反映", async () => {
      const game = await createGame(managerA);
      const unregister = registerGameUsageChecker(
        "test-books",
        (_tenantId, gameId) => Promise.resolve(String(gameId) === game.id),
      );
      try {
        const viewed = await ok<OneData>(api, managerA, ONE, { id: game.id });
        expect(viewed.lotteryGame.item).toMatchObject({
          inUse: true,
          abilities: { canEdit: true, canDelete: false },
        });
        for (const [field, value] of [
          ["gameCode", nextCode()],
          ["unitPrice", 200],
          ["ticketsPerBook", 50],
        ] as const) {
          expect(
            await errorOf(api, managerA, UPDATE, {
              input: { id: game.id, [field]: value },
            }),
          ).toMatchObject({
            code: "VALIDATION_FAILED",
            fields: [field],
            reason: "GAME_IN_USE",
          });
        }
        // 送原值(畫面送整張表單時)不算改
        const updated = await ok<UpdateData>(api, managerA, UPDATE, {
          input: {
            id: game.id,
            gameCode: game.gameCode,
            unitPrice: game.unitPrice,
            name: "改名照樣可以",
            status: "discontinued",
          },
        });
        expect(updated.updateLotteryGame.item).toMatchObject({
          name: "改名照樣可以",
          status: "discontinued",
          gameCode: game.gameCode,
        });
        expect(
          await errorOf(api, managerA, DELETE, { input: { id: game.id } }),
        ).toMatchObject({ code: "VALIDATION_FAILED", reason: "GAME_IN_USE" });
      } finally {
        unregister();
      }
    });

    it("沒有引用:改面額會重算整本金額;刪除成功後查不到", async () => {
      const game = await createGame(managerA);
      const updated = await ok<UpdateData>(api, managerA, UPDATE, {
        input: { id: game.id, unitPrice: 500, ticketsPerBook: 50 },
      });
      expect(updated.updateLotteryGame.item.bookPrice).toBe(25_000);
      await ok(api, managerA, DELETE, { input: { id: game.id } });
      expect(await errorOf(api, managerA, ONE, { id: game.id })).toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  it("選填欄位送 null = 清空;缺席 = 不動", async () => {
    const game = await createGame(managerA, { color: "blue", note: "備註" });
    const cleared = await ok<UpdateData>(api, managerA, UPDATE, {
      input: { id: game.id, color: null },
    });
    expect(cleared.updateLotteryGame.item).toMatchObject({
      color: null,
      note: "備註",
    });
  });

  it("寫入有稽核紀錄", async () => {
    const game = await createGame(managerA);
    const logs = await api.connection
      .collection("audit_logs")
      .find({ targetType: "lottery_game", action: "lottery-game.create" })
      .toArray();
    expect(logs.map((log) => String(log.targetId))).toContain(game.id);
  });
});
