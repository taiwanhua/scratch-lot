import { PURCHASE_MODULE_KEY } from "@repo/domain/project/lottery";

import { PURCHASING_GROUP_KEY } from "../../purchasing";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 表單模組的三個隱藏頁(詳情 / 新增 / 編輯)。 */
const PURCHASE_PAGES = ["view-page", "create-page", "edit-page"].map(
  (page) => `${PURCHASE_MODULE_KEY}.${page}`,
);

const MODULE_KEYS = [
  PURCHASING_GROUP_KEY,
  PURCHASE_MODULE_KEY,
  ...PURCHASE_PAGES,
];

/** 總部管理:進貨單全部(含結算 `settle`)。 */
const HQ: RoleGrant = {
  moduleKeys: MODULE_KEYS,
  permissionKeys: [
    everything(PURCHASING_GROUP_KEY),
    everything(PURCHASE_MODULE_KEY),
    ...PURCHASE_PAGES.map((key) => everything(key)),
  ],
};

/**
 * 店長:看進貨單、在申請中心點收(點收是流程關卡,不另要權限);不建單、不結算(進貨單一邊是總部,規格 9)。
 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: [
    PURCHASING_GROUP_KEY,
    PURCHASE_MODULE_KEY,
    `${PURCHASE_MODULE_KEY}.view-page`,
  ],
  permissionKeys: [
    everything(PURCHASING_GROUP_KEY),
    `${PURCHASE_MODULE_KEY}.view`,
    everything(`${PURCHASE_MODULE_KEY}.view-page`),
  ],
};

/**
 * 叫貨與進貨 → 進貨單(規格 3.3;權限表正本 `docs/modules/project/purchasing.md`「進貨單」):
 * 總部管理全部;店長看與點收;店員不給。
 */
export const purchasingPurchaseGrants: ModuleRoleGrants = {
  section: "進貨單",
  grants: { hq: HQ, "store-manager": STORE_MANAGER },
};
