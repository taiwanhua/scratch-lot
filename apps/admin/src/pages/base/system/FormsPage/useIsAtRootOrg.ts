import type { FormFieldsFragment } from "@repo/graphql";

import { useMe } from "@/hooks/base/useMe";

/** 根組織專屬(`isRootOnly`)的模組:租戶的 `me.modules` 裡根本沒有它們(ADR-0009 / ADR-0011)。 */
const ROOT_ONLY_MODULE_KEYS = new Set([
  "system.module-manager",
  "system.data-scope",
]);

/**
 * 現在是不是站在根組織(「+ 建立表單」只有根組織做得到,租戶只能以某版本為基底建客製表單)。
 *
 * `me.currentOrg` 沒有 `parentId`(api 的 `MeOrg` 只有 id / name / logoUrl,本票不改 api),所以用兩個
 * 看得到的訊號:①`me.modules` 裡有根組織專屬的模組;②表單清單裡有 `tenantEnabled === null` 的表單
 * (root 視角才是 null,docs/modules/forms.md「輸出欄位」)。都沒有就當不是 —— 寧可不顯示,
 * 真正的守門在 api(`ROOT_ONLY`)。
 */
export const useIsAtRootOrg = (
  forms: readonly FormFieldsFragment[],
): boolean => {
  const me = useMe();
  const modules = me.data?.me.modules ?? [];
  return (
    modules.some((module) => ROOT_ONLY_MODULE_KEYS.has(module.key)) ||
    forms.some((form) => form.tenantEnabled === null)
  );
};
