import { useNavigate } from "react-router";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";

import { DEALERS_MODULE_KEYS, DEALERS_PERMISSIONS } from "./dealers-keys";

/**
 * 經銷商管理各頁共用的「進得去哪、做得了什麼」(ADR-0011):
 * 路由一律從 `me.modules` 取(前端不寫死路徑);頁內按鈕看權限集。
 * 逐筆的 [編輯] 讀 api 給的 `item.abilities`,不在這裡。
 */
export const useDealersAccess = () => {
  const me = useMe();
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const modules = me.data?.me.modules ?? [];
  const routeOf = (key: string): string | null =>
    modules.find((module) => module.key === key)?.route ?? null;

  const routes = {
    list: routeOf(DEALERS_MODULE_KEYS.list),
    view: routeOf(DEALERS_MODULE_KEYS.viewPage),
    create: routeOf(DEALERS_MODULE_KEYS.createPage),
    edit: routeOf(DEALERS_MODULE_KEYS.editPage),
    contactView: routeOf(DEALERS_MODULE_KEYS.contactViewPage),
    contactCreate: routeOf(DEALERS_MODULE_KEYS.contactCreatePage),
    contactEdit: routeOf(DEALERS_MODULE_KEYS.contactEditPage),
  };

  /** 到某一頁(帶 id = 詳情 / 編輯);沒綁那一頁的模組 → 不動。回列表帶回列表頁籤記下的條件。 */
  const goTo = (route: string | null, id?: string) => {
    if (route === null) {
      return;
    }
    void navigate(id === undefined ? tabHref(route) : `${route}/${id}`);
  };

  return {
    routes,
    goTo,
    has: hasPermission,
    /** 關係人分頁:綁了 `dealers.contacts` 才看得到 */
    hasContacts: modules.some(
      (module) => module.key === DEALERS_MODULE_KEYS.contacts,
    ),
    canCreateDealer:
      routes.create !== null && hasPermission(DEALERS_PERMISSIONS.create),
    canCreateContact:
      routes.contactCreate !== null &&
      hasPermission(DEALERS_PERMISSIONS.contactsCreate),
    canEditContact: hasPermission(DEALERS_PERMISSIONS.contactsEdit),
  };
};

export type DealersAccess = ReturnType<typeof useDealersAccess>;
