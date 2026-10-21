import {
  MASTER_DATA_MODULE_KEYS as KEYS,
  MASTER_DATA_KEY,
  MASTER_DATA_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-master-data";

import type { ModuleSeedDeclaration } from "../base/module-declaration";

/**
 * 檔案管理(專案規格 3.1、3.2;正本 `docs/modules/project/master-data.md`):
 * 一頁兩個分頁(遊戲 | 收銀點)。兩個權限容器 `master-data.games` / `master-data.cash-points`
 * 兼分頁的進入條件(綁了才看得到該分頁);遊戲的新增 / 編輯 / 詳情是隱藏頁,掛在遊戲容器底下
 * (容器沒有路由,隱藏頁的完整路徑是 `/master-data/<自己那段>`)。收銀點的新增 / 編輯是彈窗,沒有頁。
 * 本模組沒有 `view` 權限(規格 3.2):讀取看模組有沒有綁。不宣告資料範圍目標。
 */
export const masterDataModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: MASTER_DATA_KEY,
      name: "檔案管理",
      sidebarType: "link",
      parentKey: null,
      order: 70,
      route: "master-data",
      icon: "folder",
      description: "遊戲與收銀點",
    },
    {
      key: KEYS.games,
      name: "遊戲",
      sidebarType: "hidden",
      parentKey: MASTER_DATA_KEY,
      order: 1,
      description: "遊戲分頁(權限容器)",
    },
    {
      key: KEYS.gameViewPage,
      name: "遊戲詳情",
      sidebarType: "hidden",
      parentKey: KEYS.games,
      order: 1,
      route: "game-view-page",
    },
    {
      key: KEYS.gameCreatePage,
      name: "新增遊戲",
      sidebarType: "hidden",
      parentKey: KEYS.games,
      order: 2,
      route: "game-create-page",
    },
    {
      key: KEYS.gameEditPage,
      name: "編輯遊戲",
      sidebarType: "hidden",
      parentKey: KEYS.games,
      order: 3,
      route: "game-edit-page",
    },
    {
      key: KEYS.cashPoints,
      name: "收銀點",
      sidebarType: "hidden",
      parentKey: MASTER_DATA_KEY,
      order: 2,
      description: "收銀點分頁(權限容器)",
    },
  ],
  permissions: [
    {
      key: PERMISSIONS.gamesCreate,
      moduleKey: KEYS.games,
      name: "新增遊戲",
      description: "遊戲分頁的 [+ 新增遊戲] + 新增 API",
    },
    {
      key: PERMISSIONS.gamesEdit,
      moduleKey: KEYS.games,
      name: "編輯遊戲",
      description: "列表與詳情的 [編輯] + 編輯 API(含停售)",
    },
    {
      key: PERMISSIONS.gamesDelete,
      moduleKey: KEYS.games,
      name: "刪除遊戲",
      description: "[刪除](只有從未被引用的遊戲)+ 刪除 API",
    },
    {
      key: PERMISSIONS.cashPointsCreate,
      moduleKey: KEYS.cashPoints,
      name: "新增收銀點",
      description: "收銀點分頁的 [+ 新增收銀點] + 新增 API",
    },
    {
      key: PERMISSIONS.cashPointsEdit,
      moduleKey: KEYS.cashPoints,
      name: "編輯收銀點",
      description: "[編輯](含停用 / 啟用)+ 編輯 API",
    },
  ],
};
