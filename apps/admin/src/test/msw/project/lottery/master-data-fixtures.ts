import {
  MASTER_DATA_MODULE_KEYS as KEYS,
  MASTER_DATA_PERMISSIONS as PERMISSIONS,
  bookPriceOf,
} from "@repo/domain/project/lottery-master-data";
import {
  type LotteryCashPointFieldsFragment,
  type LotteryGameFieldsFragment,
  ModuleEngine,
  ModuleSidebarType,
} from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";

/** 檔案管理的夾具(元件測試、假 api 與 mock 模式共用)。 */

const now = "2026-10-01T00:00:00.000Z";

export const ALL_MASTER_DATA_PERMISSIONS = Object.values(PERMISSIONS);

/** 兩家分店(中山店、新竹店)掛在租戶頂層「好運彩券行」底下。 */
export const masterDataOrgs = {
  tenant: { id: "org-tenant", name: "好運彩券行" },
  storeA: { id: "org-store-a", name: "中山店" },
  storeB: { id: "org-store-b", name: "新竹店" },
};

export const game = (
  overrides: Partial<LotteryGameFieldsFragment> &
    Pick<LotteryGameFieldsFragment, "id" | "gameCode" | "name">,
): LotteryGameFieldsFragment => {
  const unitPrice = overrides.unitPrice ?? 100;
  const ticketsPerBook = overrides.ticketsPerBook ?? 100;
  return {
    __typename: "LotteryGame",
    unitPrice,
    ticketsPerBook,
    bookPrice: bookPriceOf(unitPrice, ticketsPerBook),
    defaultRate: 92,
    color: null,
    status: "on_sale",
    // 兌獎截止日 2027-07-01(租戶時區)→ 上市 2026-10-01、停售 2027-04-01(api 推算)
    launchedAt: "2026-09-30T16:00:00.000Z",
    discontinuedAt: "2027-03-31T16:00:00.000Z",
    claimDeadline: "2027-06-30T16:00:00.000Z",
    note: null,
    inUse: false,
    createdAt: now,
    updatedAt: now,
    abilities: {
      __typename: "LotteryGameAbilities",
      canEdit: true,
      canDelete: true,
    },
    ...overrides,
  };
};

/** Figma MD-01 的六筆。 */
export const sampleGames = (): LotteryGameFieldsFragment[] => [
  game({
    id: "g-5201",
    gameCode: "5201",
    name: "金好運",
    color: "yellow",
    inUse: true,
  }),
  game({
    id: "g-5164",
    gameCode: "5164",
    name: "發大財",
    color: "red",
    unitPrice: 200,
    inUse: true,
  }),
  game({ id: "g-5198", gameCode: "5198", name: "鼠來寶", color: "blue" }),
  game({
    id: "g-5150",
    gameCode: "5150",
    name: "好運旺旺",
    color: "green",
    unitPrice: 500,
    ticketsPerBook: 50,
  }),
  game({
    id: "g-5133",
    gameCode: "5133",
    name: "招財貓",
    color: "purple",
    unitPrice: 1000,
    ticketsPerBook: 25,
  }),
  game({
    id: "g-4980",
    gameCode: "4980",
    name: "舊彩",
    color: "grey",
    status: "discontinued",
    defaultRate: 90,
    inUse: true,
  }),
];

export const cashPoint = (
  overrides: Partial<LotteryCashPointFieldsFragment> &
    Pick<LotteryCashPointFieldsFragment, "id" | "name" | "positionKey">,
): LotteryCashPointFieldsFragment => ({
  __typename: "LotteryCashPoint",
  org: { __typename: "LotteryCashPointRef", ...masterDataOrgs.storeA },
  positionLabel: null,
  order: 1,
  enabled: true,
  printer: null,
  note: null,
  createdAt: now,
  updatedAt: now,
  abilities: { __typename: "LotteryCashPointAbilities", canEdit: true },
  ...overrides,
});

/** Figma MD-05 的三筆。 */
export const sampleCashPoints = (): LotteryCashPointFieldsFragment[] => [
  cashPoint({
    id: "cp-counter",
    name: "店內櫃台",
    positionKey: "in-store-counter",
    positionLabel: "店內櫃台",
    printer: {
      __typename: "LotteryCashPointRef",
      id: "printer-1",
      name: "櫃台收據機",
    },
  }),
  cashPoint({
    id: "cp-outdoor",
    name: "店外攤位",
    positionKey: "outdoor-stall",
    positionLabel: "店外攤位",
    order: 2,
  }),
  cashPoint({
    id: "cp-machine",
    name: "彩券機旁",
    positionKey: "lottery-machine",
    positionLabel: "彩券機旁",
    order: 3,
    enabled: false,
  }),
];

export const positionOptions = [
  { value: "in-store-counter", label: "店內櫃台" },
  { value: "outdoor-stall", label: "店外攤位" },
  { value: "restock", label: "補貨" },
  { value: "lottery-machine", label: "彩券機旁" },
];

const module = (
  key: string,
  name: string,
  parentId: string | null,
  route: string | null,
  permissions: readonly string[],
  sidebarType = ModuleSidebarType.Hidden,
): TestModule => ({
  __typename: "MeModule",
  id: `m-${key}`,
  key,
  name,
  parentId,
  sidebarType,
  engine: ModuleEngine.Fixed,
  order: 70,
  route,
  icon: "folder",
  permissions: [...permissions],
});

/**
 * 檔案管理的模組(與 seed 宣告一致):`games` / `cashPoints` 決定綁不綁那個分頁容器(與它的頁),
 * `permissions` 給個別權限。
 */
export const masterDataModules = ({
  permissions = ALL_MASTER_DATA_PERMISSIONS,
  games = true,
  cashPoints = true,
}: {
  permissions?: readonly string[];
  games?: boolean;
  cashPoints?: boolean;
} = {}): TestModule[] => {
  const of = (prefix: string) =>
    permissions.filter((key) => key.startsWith(`${prefix}.`));
  const root = module(
    KEYS.list,
    "檔案管理",
    null,
    "/master-data",
    [],
    ModuleSidebarType.Link,
  );
  return [
    root,
    ...(games
      ? [
          module(KEYS.games, "遊戲", root.id, null, of(KEYS.games)),
          module(
            KEYS.gameViewPage,
            "遊戲詳情",
            `m-${KEYS.games}`,
            "/master-data/game-view-page",
            [],
          ),
          module(
            KEYS.gameCreatePage,
            "新增遊戲",
            `m-${KEYS.games}`,
            "/master-data/game-create-page",
            [],
          ),
          module(
            KEYS.gameEditPage,
            "編輯遊戲",
            `m-${KEYS.games}`,
            "/master-data/game-edit-page",
            [],
          ),
        ]
      : []),
    ...(cashPoints
      ? [module(KEYS.cashPoints, "收銀點", root.id, null, of(KEYS.cashPoints))]
      : []),
  ];
};
