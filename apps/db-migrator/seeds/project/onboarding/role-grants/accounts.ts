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
 * 店長:即時現金帳、待結清款項(規格 3.3);**不含**銀行帳戶的登記交易 / 沖正與關帳。
 * 銀行帳戶分頁與主檔修改不在店長的清單內(付款視窗選帳戶走 lookup,不需要分頁)。
 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: [ACCOUNTS_KEY],
  permissionKeys: [PERMISSIONS.viewCash, PERMISSIONS.viewOutstanding],
};

/**
 * 帳戶管理(規格 3.3;權限表正本 `docs/modules/project/accounts.md`):
 * 總部管理全部、店長即時現金帳 + 待結清款項、店員不給。
 */
export const accountsGrants: ModuleRoleGrants = {
  section: "帳戶管理",
  grants: { hq: HQ, "store-manager": STORE_MANAGER },
};
