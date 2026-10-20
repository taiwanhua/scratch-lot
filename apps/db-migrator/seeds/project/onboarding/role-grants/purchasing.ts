import { REQUISITION_MODULE_KEY } from "@repo/domain/project/lottery";

import { PURCHASING_GROUP_KEY } from "../../purchasing";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 表單模組的三個隱藏頁(詳情 / 新增 / 編輯)。 */
const REQUISITION_PAGES = ["view-page", "create-page", "edit-page"].map(
  (page) => `${REQUISITION_MODULE_KEY}.${page}`,
);

const MODULE_KEYS = [
  PURCHASING_GROUP_KEY,
  REQUISITION_MODULE_KEY,
  ...REQUISITION_PAGES,
];

/** 總部管理:叫貨、採購單全部(含採購清單 `purchase-list`)。 */
const HQ: RoleGrant = {
  moduleKeys: MODULE_KEYS,
  permissionKeys: [
    everything(PURCHASING_GROUP_KEY),
    everything(REQUISITION_MODULE_KEY),
    ...REQUISITION_PAGES.map((key) => everything(key)),
  ],
};

/** 店長:叫貨(表單四條);採購清單是總部的分頁,不給(規格 3.1「採購清單(總部)」)。 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: MODULE_KEYS,
  permissionKeys: [
    everything(PURCHASING_GROUP_KEY),
    ...["view", "create", "edit", "delete"].map(
      (action) => `${REQUISITION_MODULE_KEY}.${action}`,
    ),
    ...REQUISITION_PAGES.map((key) => everything(key)),
  ],
};

/**
 * 叫貨與進貨 → 叫貨、採購單(規格 3.3;權限表正本 `docs/modules/project/purchasing.md`「開通時建立的角色」):
 * 總部管理全部;店長叫貨;店員不給。進貨單、調貨單由各自的票在本檔以外另加一段。
 */
export const purchasingGrants: ModuleRoleGrants = {
  section: "叫貨、採購單",
  grants: { hq: HQ, "store-manager": STORE_MANAGER },
};
