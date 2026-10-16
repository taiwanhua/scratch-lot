import { useMe } from "./useMe";

/** 根組織專屬(`isRootOnly`)的模組:租戶的 `me.modules` 裡根本沒有它們(ADR-0009 / ADR-0011)。 */
const ROOT_ONLY_MODULE_KEYS: ReadonlySet<string> = new Set([
  "system.module-manager",
  "system.data-scope",
]);

/**
 * `me.modules` 裡有沒有根組織專屬的模組 —— 「現在站在根組織」看得到的訊號之一
 * (`me.currentOrg` 沒有 `parentId`)。沒有不代表一定不在根組織(操作者可能沒被授予那兩個模組),
 * 所以只拿來**收起**租戶專屬的按鈕;真正的守門在 api(`ROOT_ONLY` / `TENANT_ONLY`)。
 */
export const useHasRootOnlyModules = (): boolean => {
  const me = useMe();
  const modules = me.data?.me.modules ?? [];
  return modules.some((module) => ROOT_ONLY_MODULE_KEYS.has(module.key));
};
