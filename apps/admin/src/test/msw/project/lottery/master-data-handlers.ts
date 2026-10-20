import { HttpResponse } from "msw";

import {
  MASTER_DATA_PERMISSIONS as PERMISSIONS,
  bookPriceOf,
} from "@repo/domain/project/lottery-master-data";
import {
  type CreateLotteryCashPointMutationVariables,
  type CreateLotteryGameMutationVariables,
  type DeleteLotteryGameMutationVariables,
  type LotteryCashPointFieldsFragment,
  type LotteryCashPointsQueryVariables,
  type LotteryGameFieldsFragment,
  type LotteryGameQueryVariables,
  type LotteryGamesQueryVariables,
  type UpdateLotteryCashPointMutationVariables,
  type UpdateLotteryGameMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  ALL_MASTER_DATA_PERMISSIONS,
  cashPoint,
  game,
  masterDataOrgs,
  positionOptions,
  sampleCashPoints,
  sampleGames,
} from "./master-data-fixtures";

/**
 * 檔案管理(遊戲、收銀點)的假 api(夾具在 `master-data-fixtures.ts`;規則照 `docs/modules/project/master-data.md`):
 * 有狀態 —— 新增 / 編輯 / 刪除後重查看得到;遊戲代號重複 → `GAME_CODE_DUPLICATE`;
 * 有庫存(`inUse`)改鎖定欄位或刪除 → `GAME_IN_USE`;收銀點同分店同崗位 / 同名 → 對應原因。
 * `abilities` 由這裡依「給的權限」算好(api 的職責),元件只讀。
 * 元件測試與 mock 模式共用(`mock/project/mock-world.ts`)。
 */

export interface MasterDataWorldOptions {
  games?: LotteryGameFieldsFragment[];
  cashPoints?: LotteryCashPointFieldsFragment[];
  /** 依權限算 abilities(同 api) */
  permissions?: readonly string[];
}

export interface MasterDataWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    createGame: CreateLotteryGameMutationVariables["input"][];
    updateGame: UpdateLotteryGameMutationVariables["input"][];
    createCashPoint: CreateLotteryCashPointMutationVariables["input"][];
    updateCashPoint: UpdateLotteryCashPointMutationVariables["input"][];
  };
}

const validation = (reason: string, fields: string[]) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields });

export const masterDataWorld = ({
  games = sampleGames(),
  cashPoints = sampleCashPoints(),
  permissions = ALL_MASTER_DATA_PERMISSIONS,
}: MasterDataWorldOptions = {}): MasterDataWorld => {
  const has = (key: string) => permissions.includes(key);
  const withGameAbilities = (row: LotteryGameFieldsFragment) => ({
    ...row,
    abilities: {
      __typename: "LotteryGameAbilities" as const,
      canEdit: has(PERMISSIONS.gamesEdit),
      canDelete: has(PERMISSIONS.gamesDelete) && !row.inUse,
    },
  });
  const withPointAbilities = (row: LotteryCashPointFieldsFragment) => ({
    ...row,
    abilities: {
      __typename: "LotteryCashPointAbilities" as const,
      canEdit: has(PERMISSIONS.cashPointsEdit),
    },
  });
  let gameState = games.map((row) => withGameAbilities(row));
  let pointState = cashPoints.map((row) => withPointAbilities(row));
  const inputs: MasterDataWorld["inputs"] = {
    createGame: [],
    updateGame: [],
    createCashPoint: [],
    updateCashPoint: [],
  };

  const handlers: MasterDataWorld["handlers"] = [
    api.query("LotteryGames", ({ variables }) => {
      const { input } = variables as LotteryGamesQueryVariables;
      const keyword = input.keyword?.trim() ?? "";
      const items = gameState.filter(
        (row) =>
          (!input.status || row.status === input.status) &&
          (input.unitPrice == null || row.unitPrice === input.unitPrice) &&
          (keyword === "" ||
            row.gameCode.includes(keyword) ||
            row.name.includes(keyword)),
      );
      return HttpResponse.json({
        data: {
          lotteryGames: {
            items,
            totalCount: items.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("LotteryGame", ({ variables }) => {
      const { id } = variables as LotteryGameQueryVariables;
      const item = gameState.find((row) => row.id === id);
      return item === undefined
        ? graphqlError("VALIDATION_FAILED", "NOT_FOUND", { code: "NOT_FOUND" })
        : HttpResponse.json({ data: { lotteryGame: { item } } });
    }),
    api.mutation("CreateLotteryGame", ({ variables }) => {
      const { input } = variables as CreateLotteryGameMutationVariables;
      inputs.createGame.push(input);
      if (gameState.some((row) => row.gameCode === input.gameCode)) {
        return validation("GAME_CODE_DUPLICATE", ["gameCode"]);
      }
      const item = withGameAbilities(
        game({
          id: `g-new-${String(gameState.length)}`,
          gameCode: input.gameCode,
          name: input.name,
          unitPrice: input.unitPrice,
          ticketsPerBook: input.ticketsPerBook,
          defaultRate: input.defaultRate,
          color: input.color ?? null,
          status: input.status ?? "on_sale",
          note: input.note ?? null,
        }),
      );
      gameState = [...gameState, item];
      return HttpResponse.json({ data: { createLotteryGame: { item } } });
    }),
    api.mutation("UpdateLotteryGame", ({ variables }) => {
      const { input } = variables as UpdateLotteryGameMutationVariables;
      inputs.updateGame.push(input);
      const current = gameState.find((row) => row.id === input.id);
      if (current === undefined) {
        return graphqlError("VALIDATION_FAILED", "NOT_FOUND", {
          code: "NOT_FOUND",
        });
      }
      const locked = (
        ["gameCode", "unitPrice", "ticketsPerBook"] as const
      ).filter((key) => input[key] != null && input[key] !== current[key]);
      if (current.inUse && locked.length > 0) {
        return validation("GAME_IN_USE", [...locked]);
      }
      const changes: Omit<typeof input, "id"> & { id?: string } = { ...input };
      delete changes.id;
      // 必填欄位送 null 視同缺席(GQL-06);選填欄位 null = 清空
      const nullable = new Set([
        "color",
        "note",
        "launchedAt",
        "discontinuedAt",
        "claimDeadline",
      ]);
      const merged = {
        ...current,
        ...Object.fromEntries(
          Object.entries(changes).filter(
            ([key, value]) => value !== null || nullable.has(key),
          ),
        ),
      } as LotteryGameFieldsFragment;
      const item = withGameAbilities({
        ...merged,
        bookPrice: bookPriceOf(merged.unitPrice, merged.ticketsPerBook),
      });
      gameState = gameState.map((row) => (row.id === item.id ? item : row));
      return HttpResponse.json({ data: { updateLotteryGame: { item } } });
    }),
    api.mutation("DeleteLotteryGame", ({ variables }) => {
      const { input } = variables as DeleteLotteryGameMutationVariables;
      const current = gameState.find((row) => row.id === input.id);
      if (current?.inUse) {
        return validation("GAME_IN_USE", ["id"]);
      }
      gameState = gameState.filter((row) => row.id !== input.id);
      return HttpResponse.json({
        data: { deleteLotteryGame: { success: true, deletedId: input.id } },
      });
    }),
    api.query("LotteryCashPoints", ({ variables }) => {
      const { input } = variables as LotteryCashPointsQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryCashPoints: {
            items: pointState,
            totalCount: pointState.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("LotteryPositionOptions", () =>
      HttpResponse.json({
        data: {
          lotteryPositionOptions: {
            items: positionOptions,
            totalCount: positionOptions.length,
          },
        },
      }),
    ),
    api.mutation("CreateLotteryCashPoint", ({ variables }) => {
      const { input } = variables as CreateLotteryCashPointMutationVariables;
      inputs.createCashPoint.push(input);
      const sameOrg = pointState.filter((row) => row.org.id === input.orgId);
      if (sameOrg.some((row) => row.positionKey === input.positionKey)) {
        return validation("POSITION_DUPLICATE", ["positionKey"]);
      }
      if (sameOrg.some((row) => row.name === input.name)) {
        return validation("NAME_DUPLICATE", ["name"]);
      }
      const org =
        Object.values(masterDataOrgs).find((item) => item.id === input.orgId) ??
        masterDataOrgs.storeA;
      const item = withPointAbilities(
        cashPoint({
          id: `cp-new-${String(pointState.length)}`,
          name: input.name,
          positionKey: input.positionKey,
          positionLabel:
            positionOptions.find((option) => option.value === input.positionKey)
              ?.label ?? null,
          order: input.order ?? 0,
          org: { __typename: "LotteryCashPointRef", ...org },
          note: input.note ?? null,
        }),
      );
      pointState = [...pointState, item];
      return HttpResponse.json({ data: { createLotteryCashPoint: { item } } });
    }),
    api.mutation("UpdateLotteryCashPoint", ({ variables }) => {
      const { input } = variables as UpdateLotteryCashPointMutationVariables;
      inputs.updateCashPoint.push(input);
      const current = pointState.find((row) => row.id === input.id);
      if (current === undefined) {
        return graphqlError("VALIDATION_FAILED", "NOT_FOUND", {
          code: "NOT_FOUND",
        });
      }
      const item = {
        ...current,
        ...(input.name == null ? {} : { name: input.name }),
        ...(input.order == null ? {} : { order: input.order }),
        ...(input.enabled == null ? {} : { enabled: input.enabled }),
        ...(input.note === undefined ? {} : { note: input.note }),
      };
      pointState = pointState.map((row) => (row.id === item.id ? item : row));
      return HttpResponse.json({ data: { updateLotteryCashPoint: { item } } });
    }),
  ];
  return { handlers, inputs };
};

/**
 * 收銀點彈窗另外打的兩個**底座**端點(組織樹、可選印表機)的測試回應。mock 模式不登記它們
 * (底座 mock world 已有,操作名不可重複),只給元件測試用。
 */
export const masterDataSharedLookupHandlers = (): Parameters<
  typeof server.use
> => [
  api.query("OrgTree", () =>
    HttpResponse.json({
      data: {
        orgTree: [
          {
            __typename: "OrgNode",
            ...masterDataOrgs.tenant,
            parentId: null,
            enabled: true,
            outOfScope: false,
            ownerUserId: null,
            children: [masterDataOrgs.storeA, masterDataOrgs.storeB].map(
              (org) => ({
                __typename: "OrgNode",
                ...org,
                parentId: masterDataOrgs.tenant.id,
                enabled: true,
                outOfScope: false,
                ownerUserId: null,
                children: [],
              }),
            ),
          },
        ],
      },
    }),
  ),
  api.query("PrintablePrinters", () =>
    HttpResponse.json({
      data: {
        printablePrinters: {
          items: [],
          totalCount: 0,
          defaultPrinterId: null,
        },
      },
    }),
  ),
];
