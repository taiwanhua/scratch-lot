import { GraphQLError } from "graphql";

/**
 * 經銷商管理的業務錯誤(GQL-04):只用通用碼 `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED` /
 * `CONFLICT`,不新增 code;細分原因放 `extensions.reason`(正本 `docs/modules/project/dealers.md`「錯誤碼」)。
 */

/** `VALIDATION_FAILED` 的細分原因(`extensions.reason`;`extensions.fields` 指到出錯的欄位)。 */
export const DEALER_REASONS = {
  /** 證號在租戶內重複 */
  licenseNoDuplicate: "LICENSE_NO_DUPLICATE",
  /** 身分證字號在租戶內重複(經銷商之間 / 關係人之間) */
  nationalIdDuplicate: "NATIONAL_ID_DUPLICATE",
  /** 這個欄位不屬於這個類型(例:甲類給了店名) */
  notForType: "NOT_FOR_TYPE",
  /** 週期是季或年時,起算月份必填 */
  rentStartMonthRequired: "RENT_START_MONTH_REQUIRED",
  /** 這個身分的人數超過上限(甲:代理人 2、受託人 2、介紹人 1;乙:代理人 2、介紹人 1) */
  roleLimit: "ROLE_LIMIT",
  /** 乙類不能有受託人 */
  trusteeNotAllowed: "TRUSTEE_NOT_ALLOWED",
  /** 選的關係人沒有這個身分 */
  contactRoleMismatch: "CONTACT_ROLE_MISMATCH",
  /** 選的關係人已停用(停用後不能再被選取) */
  contactDisabled: "CONTACT_DISABLED",
  /** 經銷商本人(身分證字號相同)不能登記成自己的關係人 */
  selfRelation: "SELF_RELATION",
  /** 甲類要先有共同銷售處所才能設代理人 */
  agentRequiresCoSales: "AGENT_REQUIRES_CO_SALES",
  /** 共同銷售處所只能選乙類 */
  coSalesNotClassB: "CO_SALES_NOT_CLASS_B",
  /** 選的經銷商已解約(解約後不能再被選取) */
  dealerTerminated: "DEALER_TERMINATED",
  /** 這家分店已對應其他乙類 */
  storeOccupied: "STORE_OCCUPIED",
  /** 對應分店必須是租戶底下的組織 */
  storeNotBranch: "STORE_NOT_BRANCH",
  /** 選的資料不存在或看不到 */
  referenceNotFound: "REFERENCE_NOT_FOUND",
  /** 見簽:同一年同一季已登記 */
  signinDuplicate: "SIGNIN_DUPLICATE",
  /** 見簽:季別還沒到 */
  signinQuarterNotStarted: "SIGNIN_QUARTER_NOT_STARTED",
} as const;

export type DealerReason = (typeof DEALER_REASONS)[keyof typeof DEALER_REASONS];

/** `CONFLICT` 的細分原因:擋下並列出關聯,前端詢問後帶旗標重送就自動解除。 */
export const DEALER_CONFLICT_REASONS = {
  /** 移除共同銷售處所但還有代理人(重送 `releaseAgents: true` 一併解除) */
  agentsRequireCoSales: "AGENTS_REQUIRE_CO_SALES",
  /** 要取消的身分還有關聯(重送 `releaseRelationships: true` 一併解除) */
  roleInUse: "ROLE_IN_USE",
} as const;

export type DealerConflictReason =
  (typeof DEALER_CONFLICT_REASONS)[keyof typeof DEALER_CONFLICT_REASONS];

/** 衝突時列出的一筆關聯(前端照列在確認框裡)。 */
export interface ConflictRelationship {
  role: string;
  dealerId: string;
  dealerName: string;
  licenseNo: string;
  contactId: string;
  contactName: string;
}

export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 輸入不合法;`fields` 讓前端把錯誤標回表單欄位,`reason` 選填。 */
export function validationError(
  message: string,
  fields: string[],
  reason?: DealerReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

/** 欄位級權限:沒有 `edit-` 卻送了那個欄位(含 `null`)。 */
export function fieldForbiddenError(field: string): GraphQLError {
  return new GraphQLError(`Missing permission to write field ${field}`, {
    extensions: {
      code: "FORBIDDEN",
      reason: "FIELD_FORBIDDEN",
      fields: [field],
    },
  });
}

/** 擋下並列出關聯(`extensions.relationships`)。 */
/**
 * `hiddenCount`:另有幾筆操作者看不到的經銷商上的關聯(只回筆數,不回內容);
 * 畫面提示「另有 N 筆你看不到的關聯也會一起解除」。
 */
export function conflictError(
  message: string,
  reason: DealerConflictReason,
  relationships: readonly ConflictRelationship[],
  hiddenCount = 0,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "CONFLICT", reason, relationships, hiddenCount },
  });
}
