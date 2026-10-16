import { useCallback, useMemo } from "react";

import { hasPermission } from "@repo/domain/permission";

import { useMe } from "./useMe";

/**
 * 全域 `hasPermission(key)`(ADR-0011「前端判斷」):
 * 登入時 `me.modules` 的 permissions(完整權限 key,含展開後的 `<模組 key>.*`)組成集合,
 * 放 react-query 全域快取(`useMeQuery` 的 key)供所有頁面共用;判斷規則由 `@repo/domain/permission` 提供(STRUCT-07)。
 */
export const usePermissions = () => {
  const me = useMe();
  const modules = me.data?.me.modules;

  const granted = useMemo<ReadonlySet<string>>(
    () => new Set(modules?.flatMap((module) => module.permissions)),
    [modules],
  );

  const check = useCallback(
    (key: string) => hasPermission(granted, key),
    [granted],
  );

  return { hasPermission: check, isReady: me.isSuccess };
};
