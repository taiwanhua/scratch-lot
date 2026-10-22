import { GraphQLError } from "graphql";

import type { OperatorContext } from "../../database/operator-context";

/**
 * 根組織進專案功能的原因碼:沿用底座「站在根組織做租戶專屬的事」的回應(`FORBIDDEN` + reason
 * `TENANT_ONLY`,先例通知設定、側欄數字設定、流程綁定)。根組織不屬於任何機構,沒有店面、庫存、帳戶、
 * 排班這些資料;要看某個機構的資料先切進那個機構(ADR-0014、Spec #143 定案 8)。
 * admin 在發查詢前就先擋下並顯示「目前在平台層級」的提示,這裡是 api 自己的防線。
 */
export const TENANT_ONLY_REASON = "TENANT_ONLY";

/** 根組織進專案功能:一律回這個錯誤(各模組同一種做法,不回空清單、不回「分店不存在」)。 */
export function rootOrgError(): GraphQLError {
  return new GraphQLError(
    "The root org belongs to no tenant; switch into a tenant first",
    { extensions: { code: "FORBIDDEN", reason: TENANT_ONLY_REASON } },
  );
}
/**
 * 當前組織是不是根組織(不讀資料庫,與 `tenantOfOperator` 同一判準):當前組織不在任何租戶的
 * 所屬組織分組裡、且可見範圍是全部 → 根組織。沒有當前組織(系統上下文)不算。
 */
export function isAtRootOrg(operator: OperatorContext): boolean {
  const current = operator.currentOrgId;
  if (current === null) {
    return false;
  }
  const inTenant = operator.memberTenants.some((group) =>
    group.memberOrgIds.some((id) => id.equals(current)),
  );
  return !inTenant && operator.visibleOrgIds === "all";
}
