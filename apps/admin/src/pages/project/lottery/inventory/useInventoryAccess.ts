import { useMe } from "@/hooks/base/useMe";

import {
  INVENTORY_MODULE_KEYS as KEYS,
  WHOLESALE_VIEW_PAGE_KEY,
} from "./inventory-config";

export interface InventoryAccess {
  /** 綁了庫存管理(本模組沒有 `view`:讀取看模組有沒有綁) */
  hasModule: boolean;
  /** 本的詳情頁的路由;沒綁詳情頁 = null(列上點不進去) */
  bookRoute: string | null;
  /** 列表頁的路由 */
  listRoute: string | null;
  /** 期初建檔頁的路由;沒綁 = null(頁首沒有 [期初建檔]) */
  openingRoute: string | null;
  /** 批售單檢視頁的路由;沒綁(或沒有批售單模組)= null(單號不是連結) */
  wholesaleRoute: string | null;
}

/**
 * 庫存管理各頁共用的「進得去哪」(ADR-0011)。詳情頁上的按鈕(更正跳號、尋回、報廢、成本)讀 api 的
 * `abilities`;預計要給本數能不能改讀 api 的 `canEdit`,不在這裡。
 */
export const useInventoryAccess = (): InventoryAccess => {
  const me = useMe();
  const modules = me.data?.me.modules ?? [];
  const routeOf = (key: string): string | null =>
    modules.find((module) => module.key === key)?.route ?? null;
  return {
    hasModule: modules.some((module) => module.key === KEYS.list),
    bookRoute: routeOf(KEYS.bookPage),
    listRoute: routeOf(KEYS.list),
    openingRoute: routeOf(KEYS.openingPage),
    wholesaleRoute: routeOf(WHOLESALE_VIEW_PAGE_KEY),
  };
};
