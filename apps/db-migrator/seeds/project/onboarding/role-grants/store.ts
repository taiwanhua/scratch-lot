import {
  CHECKOUT_CREATE_PERMISSION,
  STORE_MODULE_KEYS as KEYS,
  STORE_PERMISSIONS as P,
  STOCKTAKE_CONFIRM_FORM_KEY,
  STORE_FORM_PERMISSIONS,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 表單模組主節點 + 三個隱藏頁(詳情 / 新增 / 編輯)。 */
const NODES = [STORE_KEY, KEYS.viewPage, KEYS.createPage, KEYS.editPage];

/** 總部管理:店面管理全部(各節點 `*`)。 */
const HQ: RoleGrant = {
  moduleKeys: NODES,
  permissionKeys: NODES.map((key) => everything(key)),
};

/** 店長:店面管理全部(含 `bank-deposit` 存銀行,規格 3.3)。 */
const STORE_MANAGER: RoleGrant = HQ;

/**
 * 店員(規格 3.3):看板 + 銷售、當下撤銷、拆本、移櫃、兌獎、開班、投庫、出庫、盤點、結帳(含結帳確認申請的新增)、
 * 撤銷售出、現金更正與盤點確認申請的新增(表單發布時建立的 `store.create-<formKey>`);**不含** `bank-deposit`。
 */
const CLERK: RoleGrant = {
  moduleKeys: [STORE_KEY, KEYS.viewPage, KEYS.createPage],
  permissionKeys: [
    P.view,
    P.sell,
    P.undoSale,
    P.split,
    P.move,
    P.redeem,
    P.openShift,
    P.deposit,
    P.withdraw,
    P.stocktake,
    `${STORE_KEY}.create-${STOCKTAKE_CONFIRM_FORM_KEY}`,
    P.checkout,
    CHECKOUT_CREATE_PERMISSION,
    STORE_FORM_PERMISSIONS.createSaleReversal,
    STORE_FORM_PERMISSIONS.createCashCorrection,
  ],
};

/**
 * 店面管理(規格 3.3;權限表正本 `docs/modules/project/store.md`):
 * 總部管理與店長全部、店員照規格 3.3 的清單。
 */
export const storeGrants: ModuleRoleGrants = {
  section: "店面管理",
  grants: { hq: HQ, "store-manager": STORE_MANAGER, clerk: CLERK },
};
