import { WHOLESALE_MODULE_KEY } from "@repo/domain/project/lottery";

import { PURCHASING_GROUP_KEY } from "../../purchasing";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 表單模組的三個隱藏頁(詳情 / 新增 / 編輯)。 */
const WHOLESALE_PAGES = ["view-page", "create-page", "edit-page"].map(
  (page) => `${WHOLESALE_MODULE_KEY}.${page}`,
);

/** 總部管理與店長都是批售單全部(店長要開單、收錢、核准)。 */
const ALL: RoleGrant = {
  moduleKeys: [PURCHASING_GROUP_KEY, WHOLESALE_MODULE_KEY, ...WHOLESALE_PAGES],
  permissionKeys: [
    everything(PURCHASING_GROUP_KEY),
    everything(WHOLESALE_MODULE_KEY),
    ...WHOLESALE_PAGES.map((key) => everything(key)),
  ],
};

/**
 * 叫貨與進貨 → 批售單(規格 21.8;權限表正本 `docs/modules/project/purchasing.md`「批售單」):
 * 總部管理、店長全部;店員不給。批售客戶的權限在 `dealers.ts`。
 * 已開通的租戶由 `migrations/project/20261126120000_data_wholesale-role-grants.js` 補。
 */
export const purchasingWholesaleGrants: ModuleRoleGrants = {
  section: "批售單",
  grants: { hq: ALL, "store-manager": ALL },
};
