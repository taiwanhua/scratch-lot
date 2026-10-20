import { TRANSFER_MODULE_KEY } from "@repo/domain/project/lottery";

import { PURCHASING_GROUP_KEY } from "../../purchasing";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 表單模組的三個隱藏頁(詳情 / 新增 / 編輯)。 */
const TRANSFER_PAGES = ["view-page", "create-page", "edit-page"].map(
  (page) => `${TRANSFER_MODULE_KEY}.${page}`,
);

/** 總部管理與店長都是調貨單全部(四條 + 零碎張數 + 收貨店付款 + 出貨店收款;哪一邊由分店決定)。 */
const ALL: RoleGrant = {
  moduleKeys: [PURCHASING_GROUP_KEY, TRANSFER_MODULE_KEY, ...TRANSFER_PAGES],
  permissionKeys: [
    everything(PURCHASING_GROUP_KEY),
    everything(TRANSFER_MODULE_KEY),
    ...TRANSFER_PAGES.map((key) => everything(key)),
  ],
};

/**
 * 叫貨與進貨 → 調貨單(規格 3.3「店長 … 調貨」;權限表正本 `docs/modules/project/purchasing.md`「調貨單」):
 * 總部管理、店長全部(店長在出貨店收款、在收貨店付款,兩邊都要);店員不給。
 */
export const purchasingTransferGrants: ModuleRoleGrants = {
  section: "調貨單",
  grants: { hq: ALL, "store-manager": ALL },
};
