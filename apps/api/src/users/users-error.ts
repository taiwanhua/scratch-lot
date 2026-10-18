import { GraphQLError } from "graphql";

/**
 * 使用者管理的業務錯誤碼(GQL-04:`extensions.code` 列舉值;清單正本 docs/standards/api/graphql-schema.md)。
 * message 給開發者看(英文);使用者文案由前端依 code 對應。
 * 沿用的通用碼(`FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`)不重複宣告於此。
 */
export const USER_ERROR_CODES = [
  /** 最後一個所屬組織不可移除(使用者至少要有一個所屬組織,ADR-0003) */
  "LAST_ORG",
  /** 防越權:操作者只能授予擁有組織在自己管理範圍內的角色(ADR-0003;與 grantRoleUsers 同判準) */
  "ROLE_OUT_OF_REACH",
  /** 擁有者保護:租戶擁有者不可停用 / 移出租戶 / 解除其租戶管理員授予(ADR-0009;根組織操作者例外) */
  "OWNER_PROTECTED",
  /**
   * 授予資格未過:該使用者的所屬組織皆不在角色擁有組織的子樹內(ADR-0003)。
   * 兩個入口(`assignUserRoles` / `grantRoleUsers`)共用同一個判斷與同一個碼 —
   * 在此之前使用者頁回的是 `VALIDATION_FAILED`,前端只講得出「資料未通過驗證」。
   */
  "USER_NOT_ELIGIBLE",
  /** 已停用的角色不可新授予(既有授予不受影響);`extensions.roleId` 指出是哪一個 */
  "ROLE_DISABLED",
] as const;

export type UserErrorCode = (typeof USER_ERROR_CODES)[number];

export function userError(code: UserErrorCode, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

/**
 * 授予資格未過(`USER_NOT_ELIGIBLE`):`extensions` 附 `roleId` 與 `ownerOrgName`,
 * 前端據此顯示「此角色只能授予 <擁有組織> 及其下層的使用者」而不是一句空泛的驗證失敗。
 * `ownerOrgName` 在擁有組織落在操作者管理範圍外(名稱不外露)或角色沒有擁有組織時為 null。
 */
export function userNotEligibleError(
  message: string,
  extra: { roleId: string; ownerOrgName: string | null },
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "USER_NOT_ELIGIBLE", ...extra },
  });
}

/** 已停用的角色不可新授予(`ROLE_DISABLED`):`extensions.roleId` 讓前端講得出是哪一個。 */
export function roleDisabledError(roleId: string): GraphQLError {
  return new GraphQLError(
    `Role ${roleId} is disabled and cannot be newly granted`,
    { extensions: { code: "ROLE_DISABLED", roleId } },
  );
}

/** 查的使用者 / 組織 / 角色在操作者可見範圍內不存在(GQL-04 `NOT_FOUND`)。 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/** 有登入但做了不被允許的事(GQL-04 `FORBIDDEN`):缺欄位級權限、碰可見範圍外的組織。 */
export function forbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

/**
 * 輸入不合法(GQL-04 `VALIDATION_FAILED`):`extensions.fields` 列出有問題的欄位,
 * 前端據此把錯誤標在對應的表單欄位上(如帳號 / Email 重複)。
 */
export function validationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}
