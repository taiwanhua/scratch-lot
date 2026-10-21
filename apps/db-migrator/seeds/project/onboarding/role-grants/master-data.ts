import {
  MASTER_DATA_MODULE_KEYS as KEYS,
  MASTER_DATA_KEY,
  MASTER_DATA_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-master-data";

import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 遊戲分頁與詳情頁(只看,不含新增 / 編輯 / 刪除)。 */
const GAME_VIEW_MODULES = [MASTER_DATA_KEY, KEYS.games, KEYS.gameViewPage];

/** 總部管理:檔案管理全部(各節點 `*`)。 */
const HQ: RoleGrant = {
  moduleKeys: [
    ...GAME_VIEW_MODULES,
    KEYS.gameCreatePage,
    KEYS.gameEditPage,
    KEYS.cashPoints,
  ],
  permissionKeys: [
    MASTER_DATA_KEY,
    KEYS.games,
    KEYS.gameViewPage,
    KEYS.gameCreatePage,
    KEYS.gameEditPage,
    KEYS.cashPoints,
  ].map((key) => everything(key)),
};

/** 店長:收銀點(新增、編輯);遊戲只看(規格 3.3「不含主檔修改」)。 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: [...GAME_VIEW_MODULES, KEYS.cashPoints],
  permissionKeys: [PERMISSIONS.cashPointsCreate, PERMISSIONS.cashPointsEdit],
};

/**
 * 檔案管理(規格 3.3;權限表正本 `docs/modules/project/master-data.md`):
 * 總部管理全部、店長收銀點 + 看遊戲、店員不給。
 */
export const masterDataGrants: ModuleRoleGrants = {
  section: "檔案管理",
  grants: { hq: HQ, "store-manager": STORE_MANAGER },
};
