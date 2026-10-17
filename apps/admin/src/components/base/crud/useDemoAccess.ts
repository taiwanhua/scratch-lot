import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";

import type {
  DemoAccess,
  DemoModuleKeys,
  DemoModulePermissions,
} from "./demo-module-config";

/**
 * 示範家族三頁共用的「進得去哪、做得了什麼」(ADR-0011)。
 *
 * 兩件事刻意分開問:
 * - **進得去哪一頁**看的是 `me.modules` 裡有沒有那個模組(「可進 = 有那個模組路由」,僅此一條);
 *   路由字串一律從模組陣列取,不在前端寫死路徑 —— seed 改了 route 這裡自動跟著改。
 * - **頁內能做什麼**看權限集(`usePermissions`)。
 *
 * 逐列的編輯 / 刪除**不在這裡** —— 那兩個由 api 算在 `item.abilities` 上,前端直接用;
 * 重算一次就會與 api 對不起來。
 */
export const useDemoAccess = (
  moduleKeys: DemoModuleKeys,
  permissions: DemoModulePermissions,
): DemoAccess => {
  const me = useMe();
  const { hasPermission } = usePermissions();
  const modules = me.data?.me.modules ?? [];

  const routeOf = (key: string): string | null =>
    modules.find((module) => module.key === key)?.route ?? null;

  const createRoute = routeOf(moduleKeys.createPage);

  return {
    listRoute: routeOf(moduleKeys.list),
    viewRoute: routeOf(moduleKeys.viewPage),
    createRoute,
    editRoute: routeOf(moduleKeys.editPage),
    canCreate: createRoute !== null && hasPermission(permissions.create),
    has: hasPermission,
  };
};
