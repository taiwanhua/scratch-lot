import {
  INVENTORY_KEY,
  INVENTORY_MODULE_KEYS as KEYS,
  INVENTORY_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery";

import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

const NODES = [INVENTORY_KEY, KEYS.bookPage];

/** 總部管理:庫存管理全部(各節點 `*`,含修改預計要給本數)。 */
const HQ: RoleGrant = {
  moduleKeys: NODES,
  permissionKeys: NODES.map((key) => everything(key)),
};

/** 店長:庫存管理,**不含** `edit-allocations`(規格 3.3;預計要給本數唯讀)。 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: NODES,
  permissionKeys: [
    PERMISSIONS.markSkipped,
    PERMISSIONS.recover,
    PERMISSIONS.scrap,
    PERMISSIONS.showCost,
  ],
};

/**
 * 庫存管理(規格 3.3;權限表正本 `docs/modules/project/inventory.md`):
 * 總部管理全部、店長除了修改預計要給本數之外全部、店員不給。
 */
export const inventoryGrants: ModuleRoleGrants = {
  section: "庫存管理",
  grants: { hq: HQ, "store-manager": STORE_MANAGER },
};
