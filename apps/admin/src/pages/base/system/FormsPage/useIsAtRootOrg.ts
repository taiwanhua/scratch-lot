import type { FormFieldsFragment } from "@repo/graphql";

import { useHasRootOnlyModules } from "@/hooks/base/useHasRootOnlyModules";

/**
 * 現在是不是站在根組織(「+ 建立表單」只有根組織做得到,租戶只能以某版本為基底建客製表單)。
 *
 * `me.currentOrg` 沒有 `parentId`(api 的 `MeOrg` 只有 id / name / logoUrl,本票不改 api),所以用兩個
 * 看得到的訊號:①`me.modules` 裡有根組織專屬的模組(`useHasRootOnlyModules`);②表單清單裡有
 * `tenantEnabled === null` 的表單(root 視角才是 null,docs/modules/forms.md「輸出欄位」)。
 * 都沒有就當不是 —— 寧可不顯示,真正的守門在 api(`ROOT_ONLY`)。
 */
export const useIsAtRootOrg = (
  forms: readonly FormFieldsFragment[],
): boolean => {
  const hasRootOnlyModules = useHasRootOnlyModules();
  return (
    hasRootOnlyModules || forms.some((form) => form.tenantEnabled === null)
  );
};
