import { useCallback } from "react";

import { useMe } from "./useMe";

/**
 * 模組 key → 路由(`me.modules`;ADR-0011:路由字串一律從模組陣列取,不寫死)。
 * 跨模組的頁面(申請中心)要連到各業務模組的新增 / 編輯 / 詳情頁時用;沒有那個模組(沒權限)回 null。
 */
export const useModuleRoutes = (): ((moduleKey: string) => string | null) => {
  const me = useMe();
  const modules = me.data?.me.modules;
  return useCallback(
    (moduleKey: string) =>
      modules?.find((module) => module.key === moduleKey)?.route ?? null,
    [modules],
  );
};
