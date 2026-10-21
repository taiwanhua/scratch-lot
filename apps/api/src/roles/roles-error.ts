import { GraphQLError } from "graphql";

import type { AudienceReference } from "../audience/audience-references.service";

/**
 * 角色管理的業務錯誤碼(GQL-04:`extensions.code` 列舉值;清單正本 docs/standards/api/graphql-schema.md)。
 * message 給開發者看(英文);使用者文案由前端依 code 對應。
 * 沿用的通用碼(`FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED`)不重複宣告於此。
 */
export const ROLE_ERROR_CODES = [
  /**
   * 防越權(ADR-0004「操作者只能授出自身有效權限集的子集」):
   * 權限矩陣送出的模組 / 權限不在操作者的有效權限集內,或租戶副本被擴權(只能縮不能擴)。
   * 與使用者管理的同名碼是同一件事的兩個入口(指派角色 / 編輯矩陣),清單正本是 GQL-04 的表。
   */
  "ROLE_OUT_OF_REACH",
  /** 刪除前置檢查未通過;`extensions.reasons` 逐項列出(docs/modules/role-manager.md 權限表「刪除」) */
  "ROLE_NOT_DELETABLE",
  /** 加入使用者的候選規則未過:該使用者的所屬組織皆不在角色擁有組織的子樹內(ADR-0003) */
  "USER_NOT_ELIGIBLE",
  /** 擁有者保護(ADR-0009):租戶擁有者的「租戶管理員」授予不可被解除(根組織操作者不受限) */
  "OWNER_PROTECTED",
] as const;

export type RoleErrorCode = (typeof ROLE_ERROR_CODES)[number];

/**
 * 刪除被擋的原因(docs/modules/role-manager.md 權限表「刪除」的前置四項)。
 * 前端逐項對應中文提示,並引導改用停用。
 */
export const ROLE_NOT_DELETABLE_REASONS = [
  /** 還有人被授予這個角色(`user_role`);先在「分配使用者」把人移除 */
  "HAS_GRANTS",
  /** 種子角色(`roles.isSystem` 或有 `key`):隨底座出貨,不可刪 */
  "SYSTEM_ROLE",
  /** 開通租戶時複製出來的租戶管理員副本(`settings.templateKey`,ADR-0009):租戶的根本角色,不可刪 */
  "TEMPLATE_COPY",
  /**
   * 還被人員條件引用(通知設定的收件人、流程的審核者 / 知會 / 逾時提醒的通知對象、資料範圍的套用對象);
   * 引用處逐項放在 `extensions.references`,先從那些設定移除
   */
  "REFERENCED_BY_AUDIENCE",
] as const;

export type RoleNotDeletableReason =
  (typeof ROLE_NOT_DELETABLE_REASONS)[number];

/**
 * `FORBIDDEN` 的 `extensions.reason`(角色種類規則;正本
 * `docs/modules/role-manager.md` 的規則表與 `role-rules.ts`)。
 * `FORBIDDEN` 是通用碼,光看碼分不出「為什麼不行」— 前端要據此顯示不同的一句話。
 */
export const ROLE_FORBIDDEN_REASONS = [
  /** 種子角色:不可改名 / 矩陣唯讀 / 不可停用(隨底座出貨,內容隨版本更新) */
  "SYSTEM_ROLE",
  /** 預設角色(租戶副本)的停用只有根組織的操作者能做 */
  "TEMPLATE_COPY_ROOT_ONLY",
  /**
   * 自鎖保護:停用操作者自己正持有的角色 / 停用「模組與權限」自己那棵子樹。
   * 做得成就把自己鎖在門外,而且沒有別的入口能開回來。
   */
  "SELF_LOCK",
] as const;

export type RoleForbiddenReason = (typeof ROLE_FORBIDDEN_REASONS)[number];

/**
 * `ROLE_OUT_OF_REACH` 的 `extensions.reason`。
 * 同一個碼有兩種來源,光看碼分不出「是我自己沒有,還是這個角色本來就上不去」:
 * 沒有 reason = 操作者自身權限集不足(ADR-0004 subset-only);
 * `TEMPLATE_CEILING` = 預設角色的天花板 —— 送出的項目**內建「租戶管理員」模板角色沒有**,
 * 連 root 也放寬不了(規則正本 ADR-0004「角色種類與可改動範圍」)。
 */
export const ROLE_OUT_OF_REACH_REASONS = ["TEMPLATE_CEILING"] as const;

export type RoleOutOfReachReason = (typeof ROLE_OUT_OF_REACH_REASONS)[number];

export function roleError(
  code: RoleErrorCode,
  message: string,
  reason?: RoleOutOfReachReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code,
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

/**
 * 刪除前置未過:`ROLE_NOT_DELETABLE` + `extensions.reasons`(逐項列出,前端一次顯示全部);
 * 有 `REFERENCED_BY_AUDIENCE` 時另帶 `extensions.references`(引用處清單)。
 */
export function roleNotDeletableError(
  reasons: readonly RoleNotDeletableReason[],
  references: readonly AudienceReference[] = [],
): GraphQLError {
  return new GraphQLError(`Role is not deletable: ${reasons.join(", ")}`, {
    extensions: {
      code: "ROLE_NOT_DELETABLE",
      reasons,
      ...(references.length === 0 ? {} : { references }),
    },
  });
}

/** 查的角色 / 組織 / 使用者在操作者管理範圍內不存在(GQL-04 `NOT_FOUND`)。 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

/**
 * 有登入但做了不被允許的事(GQL-04 `FORBIDDEN`):碰管理範圍外的組織,
 * 或動了角色種類規則不許動的東西 — 後者附 `extensions.reason`(`ROLE_FORBIDDEN_REASONS`)。
 */
export function forbiddenError(
  message: string,
  reason?: RoleForbiddenReason,
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "FORBIDDEN",
      ...(reason === undefined ? {} : { reason }),
    },
  });
}

/**
 * 輸入不合法(GQL-04 `VALIDATION_FAILED`):`extensions.fields` 列出有問題的欄位,
 * 前端據此把錯誤標在對應的表單欄位上(如空白名稱)。
 */
export function validationError(
  message: string,
  fields: string[],
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION_FAILED", fields },
  });
}
