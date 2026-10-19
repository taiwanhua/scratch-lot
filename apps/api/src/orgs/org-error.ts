import { GraphQLError } from "graphql";

/**
 * 組織管理的業務錯誤碼(GQL-04:`extensions.code` 列舉值;清單正本 docs/standards/api/graphql-schema.md)。
 * message 給開發者看(英文);使用者文案由前端依 code 對應。
 */
export const ORG_ERROR_CODES = [
  /** 查的組織不存在,或不在操作者可見範圍內(不透露差別) */
  "NOT_FOUND",
  /** 輸入不合法(空名稱、`logoPath` 不是本 API 簽出來的路徑、搬移根組織…) */
  "VALIDATION_FAILED",
  /** 搬移的新上層不在同一個租戶(ADR-0005:租戶頂層以 `ancestors` 判定) */
  "CROSS_TENANT",
  /** 搬移的新上層是自己或自己的子孫(會造出環) */
  "CYCLIC_MOVE",
  /** 刪除前置檢查未通過;`extensions.reasons` 列出原因 */
  "ORG_NOT_DELETABLE",
  /**
   * 撤銷開通(根組織專屬)前置檢查未通過;`extensions.reasons` 列出原因,
   * 語彙與 `ORG_NOT_DELETABLE` 同一組(問的是同一件事:租戶底下還有沒有別的東西)。
   */
  "PROVISION_NOT_REVOKABLE",
  /**
   * 擁有者保護(ADR-0009;`owner-protection.service.ts`):租戶擁有者不可被停用 / 移出租戶 /
   * 解除其「租戶管理員」授予,根組織的操作者例外。
   * 使用者管理(`users/users-error.ts`)也會丟同一個碼 — 兩個模組各自宣告自己丟得出的碼,
   * 清單正本是 GQL-04 的表,不是其中任一個檔。
   */
  "OWNER_PROTECTED",
  /** 有登入但做了不被允許的事:非根組織的操作者執行租戶作業 */
  "FORBIDDEN",
] as const;

export type OrgErrorCode = (typeof ORG_ERROR_CODES)[number];

/**
 * 刪除被擋的原因(docs/modules/org-manager.md「刪除」的前置四項,加上根組織保護)。
 * 前端逐項對應中文提示,並引導改用停用。
 */
export const ORG_NOT_DELETABLE_REASONS = [
  /** 還有子組織(含已停用的);先處理整棵子樹 */
  "HAS_CHILDREN",
  /** 還有成員(`org_user`) */
  "HAS_MEMBERS",
  /** 是某些角色的擁有組織(`org_role`) */
  "OWNS_ROLES",
  /** 還有業務資料掛在這個組織下(會員 / 示範資料 / 租戶自訂欄位選項) */
  "HAS_BUSINESS_DATA",
  /** 系統組織(根組織)不可刪除 */
  "SYSTEM_ORG",
] as const;

export type OrgNotDeletableReason = (typeof ORG_NOT_DELETABLE_REASONS)[number];

export function orgError(code: OrgErrorCode, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

/** 輸入不合法(GQL-04 `VALIDATION_FAILED`):`extensions.fields` 讓前端標到對應的表單欄位。 */
export function orgValidationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}

/** 刪除前置未過:`ORG_NOT_DELETABLE` + `extensions.reasons`(逐項列出,前端一次顯示全部)。 */
export function orgNotDeletableError(
  reasons: readonly OrgNotDeletableReason[],
): GraphQLError {
  return new GraphQLError(`Org is not deletable: ${reasons.join(", ")}`, {
    extensions: { code: "ORG_NOT_DELETABLE", reasons },
  });
}

/**
 * 撤銷開通前置未過:`PROVISION_NOT_REVOKABLE` + `extensions.reasons`。
 *
 * 沿用刪除前置的同一組 reasons 語彙與同一支檢查函式(`OrgsService.orgContentReasons`),
 * 差別只在**擁有者與租戶管理員副本不算**:撤銷開通就是要把那兩樣一起抹掉(ADR-0009)。
 * 錯誤碼另開一個是因為前端的引導不同 —— 刪除被擋是「改用停用」,
 * 撤銷被擋是「租戶已經在用了,不該撤銷」。
 */
export function provisionNotRevokableError(
  reasons: readonly OrgNotDeletableReason[],
): GraphQLError {
  return new GraphQLError(
    `Tenant provision is not revokable: ${reasons.join(", ")}`,
    { extensions: { code: "PROVISION_NOT_REVOKABLE", reasons } },
  );
}
