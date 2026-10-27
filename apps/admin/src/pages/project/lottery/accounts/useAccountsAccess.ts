import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";

import {
  ACCOUNTS_MODULE_KEYS as KEYS,
  ACCOUNTS_PERMISSIONS as PERMISSIONS,
} from "./accounts-config";

export interface AccountsAccess {
  /** 銀行帳戶分頁(`view-bank-accounts`) */
  canViewBankAccounts: boolean;
  /** 即時現金帳分頁(`view-cash`) */
  canViewCash: boolean;
  /** 待結清款項分頁(`view-outstanding`) */
  canViewOutstanding: boolean;
  /** 關帳分頁與 [關帳](`close-period`) */
  canClosePeriod: boolean;
  /** [+ 新增帳戶](`create-bank-account`) */
  canCreateAccount: boolean;
  /** 帳戶詳情頁的路由;沒綁詳情頁 = null(列上點不進去) */
  viewRoute: string | null;
  /** 列表頁的路由 */
  listRoute: string | null;
}

/**
 * 帳戶管理各頁共用的「進得去哪、做得了什麼」(ADR-0011):本模組沒有 `view`,四個分頁各看一條權限;
 * 新增鈕看權限集;帳戶的編輯 / 刪除 / 登記交易 / 沖正讀 api 的 `abilities`,不在這裡。
 */
export const useAccountsAccess = (): AccountsAccess => {
  const me = useMe();
  const { hasPermission } = usePermissions();
  const modules = me.data?.me.modules ?? [];
  const routeOf = (key: string): string | null =>
    modules.find((module) => module.key === key)?.route ?? null;
  const viewRoute = routeOf(KEYS.bankAccountViewPage);
  return {
    canViewBankAccounts: hasPermission(PERMISSIONS.viewBankAccounts),
    canViewCash: hasPermission(PERMISSIONS.viewCash),
    canViewOutstanding: hasPermission(PERMISSIONS.viewOutstanding),
    canClosePeriod: hasPermission(PERMISSIONS.closePeriod),
    canCreateAccount: hasPermission(PERMISSIONS.createBankAccount),
    viewRoute,
    listRoute: routeOf(KEYS.list),
  };
};
