import type { ComponentType } from "react";

import { useIsAtRootOrg } from "@/hooks/base/useIsAtRootOrg";

import { RootOrgNotice } from "./RootOrgNotice";

/**
 * 專案模組頁的守門(登記時套上,`app/project/module-pages.ts`):站在根組織 → 顯示 `RootOrgNotice`,
 * 不掛頁面本身(不發任何專案查詢);站在機構裡、或 `me` 還沒載到時照常。
 */
export const withTenantRequired = <P extends object>(
  Page: ComponentType<P>,
): ComponentType<P> => {
  const TenantRequired = (props: P) =>
    useIsAtRootOrg() === true ? <RootOrgNotice /> : <Page {...props} />;
  TenantRequired.displayName = `TenantRequired(${Page.displayName ?? Page.name})`;
  return TenantRequired;
};
