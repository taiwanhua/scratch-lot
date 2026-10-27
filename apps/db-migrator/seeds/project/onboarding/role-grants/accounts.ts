import {
  ACCOUNTS_KEY,
  ACCOUNTS_MODULE_KEYS as KEYS,
  ACCOUNTS_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-accounts";

import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 總部管理:帳戶管理全部(各節點 `*`,含關帳)。 */
const HQ: RoleGrant = {
  moduleKeys: [ACCOUNTS_KEY, KEYS.bankAccountViewPage],
  permissionKeys: [ACCOUNTS_KEY, KEYS.bankAccountViewPage].map((key) =>
    everything(key),
  ),
};

/**
 * 店長:銀行帳戶(只看:分頁 + 帳戶詳情)、即時現金帳、待結清款項(規格 3.3);**不含**新增 / 編輯帳戶、
 * 登記交易 / 沖正與關帳。帳戶詳情只給模組(隱藏頁節點),不給 `accounts.view-page.*`:
 * 之後在詳情頁節點加的頁內權限不會自動落到店長身上。
 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: [ACCOUNTS_KEY, KEYS.bankAccountViewPage],
  permissionKeys: [
    PERMISSIONS.viewBankAccounts,
    PERMISSIONS.viewCash,
    PERMISSIONS.viewOutstanding,
  ],
};

/**
 * 帳戶管理(規格 3.3;權限表正本 `docs/modules/project/accounts.md`):
 * 總部管理全部、店長銀行帳戶(只看)+ 即時現金帳 + 待結清款項、店員不給。
 */
export const accountsGrants: ModuleRoleGrants = {
  section: "帳戶管理",
  grants: { hq: HQ, "store-manager": STORE_MANAGER },
};
