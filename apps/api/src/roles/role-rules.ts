import type { Persisted } from "../database/base.repository";
import type { RoleDocument } from "../database/database.module";
import {
  TEMPLATE_KEY_SETTING,
  TENANT_ADMIN_ROLE_KEY,
} from "../orgs/owner-protection.service";
import { type RoleAbilities, RoleKind } from "./models/role.model";

/** 一筆讀回來的角色文件(含基礎欄位,ADR-0007)。 */
export type RoleRecord = Persisted<RoleDocument>;

/**
 * **角色種類的判準與規則**(規則表正本 `docs/modules/role-manager.md`)。
 *
 * 三種角色、四個動作,整個平台只有這一份判斷:api 的四支寫入端點依它擋,
 * `Role.kind` / `Role.abilities` 也由它算給前端讀 —— **前端不重算**。
 * 這裡刻意是純函式(沒有 repository、沒有 await):判準只看「角色文件 + 操作者的兩個事實」,
 * 事實的取得留在 `RoleScopeService`(誰是 root、操作者持有哪些角色)。
 *
 * | 種類 | 改名 / 描述 | 權限矩陣 | 停用 | 刪除 |
 * | --- | --- | --- | --- | --- |
 * | 種子(`SYSTEM`) | 不可 | 唯讀 | 不可 | 不可 |
 * | 預設角色(`TEMPLATE_COPY`,UI 詞彙;技術文件稱租戶副本) | 可 | root 可放寬與收窄、非 root 只能收窄 | 只有 root | 不可 |
 * | 自建(`CUSTOM`) | 可 | 依 subset | 可,但不可停用操作者自己正持有的角色 | 無授予時可 |
 */

/**
 * 種子角色:`isSystem` 或有 `key`。
 *
 * 兩個判準是同一件事的兩種寫法 —— seed runner 對每一筆種子文件一律補
 * `isSystem: true`(`apps/db-migrator/src/seed/seed-runner.ts`,ADR-0002),
 * 所以 `isSystem` 才是主判準;`key` 是防守(手動塞進 `roles` 而沒掛 `isSystem` 的資料
 * 仍然是種子角色,不該被改名或刪掉)。
 */
export function isSeedRole(role: RoleRecord): boolean {
  return role.isSystem || (role.key !== undefined && role.key !== "");
}

/** 開通租戶時從「租戶管理員」模板複製出來的副本(ADR-0009;UI 稱「預設角色」)。 */
export function isTemplateCopy(role: RoleRecord): boolean {
  return role.settings[TEMPLATE_KEY_SETTING] === TENANT_ADMIN_ROLE_KEY;
}

/** 角色種類;種子優先(種子模板本身不會同時掛副本標記,但順序寫明才不會兩邊各判一次)。 */
export function roleKindOf(role: RoleRecord): RoleKind {
  if (isSeedRole(role)) {
    return RoleKind.SYSTEM;
  }
  return isTemplateCopy(role) ? RoleKind.TEMPLATE_COPY : RoleKind.CUSTOM;
}

/** 算 `abilities` 與擋寫入時共用的「操作者事實」。 */
export interface RoleOperatorFacts {
  /** 操作者的當前組織是根組織(`OwnerProtectionService.isRootOperator`)。 */
  isRootOperator: boolean;
  /** 這個角色正被操作者自己持有(`user_role`)—— 自鎖保護的判準。 */
  isHeldByOperator: boolean;
  /** 這個角色還有人被授予(`user_role` 非空)—— 刪除前置之一。 */
  hasGrants: boolean;
}

/**
 * 權限矩陣只能縮不能擴(ADR-0009):**非 root 且是預設角色**。
 *
 * 原本是「只要是預設角色就只能縮」,結果 root 也放寬不了租戶的預設角色 ——
 * 而平台方本來就該能替租戶開新模組(驗收時提出)。收窄的那一半照舊。
 */
export function isShrinkOnly(
  role: RoleRecord,
  facts: Pick<RoleOperatorFacts, "isRootOperator">,
): boolean {
  return isTemplateCopy(role) && !facts.isRootOperator;
}

/**
 * 停用 / 啟用的判斷(`setRoleEnabled` 與 `abilities.canToggleEnabled` 同一條)。
 *
 * **自鎖只擋「停用」**:啟用一個自己持有的角色不會把自己鎖在外面,所以角色已經停用時
 * 不看持有與否(否則被停用的角色永遠開不回來)。
 */
export function canToggleEnabled(
  role: RoleRecord,
  facts: RoleOperatorFacts,
): boolean {
  const kind = roleKindOf(role);
  if (kind === RoleKind.SYSTEM) {
    return false;
  }
  if (kind === RoleKind.TEMPLATE_COPY && !facts.isRootOperator) {
    return false;
  }
  // 目前是停用中 → 這一顆按鈕做的是「啟用」,自鎖不適用
  return !role.enabled || !facts.isHeldByOperator;
}

/**
 * 角色種類規則算出來的四個動作(`Role.abilities`)。
 *
 * **只含種類規則,不含操作者的權限 key 判斷** —— 「有沒有 `system.role-manager.edit`」
 * 由 `@RequirePermission` 與前端的 `usePermissions` 各守一層(ADR-0011「頁內功能」)。
 * 前端顯示按鈕的條件是兩者相乘:`ability.canEdit && role.abilities.canEdit`。
 */
export function roleAbilitiesOf(
  role: RoleRecord,
  facts: RoleOperatorFacts,
): RoleAbilities {
  const kind = roleKindOf(role);
  const isSeed = kind === RoleKind.SYSTEM;
  return {
    canEdit: !isSeed,
    canEditMatrix: !isSeed,
    canToggleEnabled: canToggleEnabled(role, facts),
    // 刪除前置三項(role-manager.md 權限表):無授予 + 非種子 + 非預設角色
    canDelete: kind === RoleKind.CUSTOM && !facts.hasGrants,
  };
}
