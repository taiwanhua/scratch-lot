import type { ComponentType } from "react";

import { useIsAtRootOrg } from "@/hooks/base/useIsAtRootOrg";

import { RootOrgNotice } from "./RootOrgNotice";

/**
 * 頁面守門(登記頁面時套上):站在根組織 → 顯示 `RootOrgNotice`,不掛頁面本身(不發頁面的任何查詢);
 * 站在最上層組織底下、或 `me` 還沒載到時照常顯示頁面。
 *
 * ```ts
 * { key: "item-report", Page: withTenantRequired(ItemReportPage) }
 * ```
 */
export const withTenantRequired = <P extends object>(
  Page: ComponentType<P>,
): ComponentType<P> => {
  const TenantRequired = (props: P) =>
    useIsAtRootOrg() === true ? <RootOrgNotice /> : <Page {...props} />;
  TenantRequired.displayName = `TenantRequired(${Page.displayName ?? Page.name})`;
  return TenantRequired;
};
