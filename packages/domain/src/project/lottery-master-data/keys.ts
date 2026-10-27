/**
 * 檔案管理(`master-data`)的模組 key 與權限 key(專案規格 3.1、3.2;權限表正本
 * `docs/modules/project/master-data.md`)。seed 宣告、api 守門、admin 判斷都引用這裡,不另寫字面值。
 */
export const MASTER_DATA_KEY = "master-data";

/** 模組樹:列表頁(分頁 遊戲 | 收銀點)、兩個權限容器(兼分頁的進入條件)、遊戲的三個隱藏頁。 */
export const MASTER_DATA_MODULE_KEYS = {
  list: MASTER_DATA_KEY,
  games: `${MASTER_DATA_KEY}.games`,
  gameViewPage: `${MASTER_DATA_KEY}.games.view-page`,
  gameCreatePage: `${MASTER_DATA_KEY}.games.create-page`,
  gameEditPage: `${MASTER_DATA_KEY}.games.edit-page`,
  cashPoints: `${MASTER_DATA_KEY}.cash-points`,
} as const;

/** 個別權限(wildcard 由 seed 自動產生)。 */
export const MASTER_DATA_PERMISSIONS = {
  gamesCreate: `${MASTER_DATA_MODULE_KEYS.games}.create`,
  gamesEdit: `${MASTER_DATA_MODULE_KEYS.games}.edit`,
  gamesDelete: `${MASTER_DATA_MODULE_KEYS.games}.delete`,
  cashPointsCreate: `${MASTER_DATA_MODULE_KEYS.cashPoints}.create`,
  cashPointsEdit: `${MASTER_DATA_MODULE_KEYS.cashPoints}.edit`,
} as const;
