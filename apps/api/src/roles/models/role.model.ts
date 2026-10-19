import { Field, ID, Int, ObjectType, registerEnumType } from "@nestjs/graphql";

/** 組織的最小參照(角色只需要 id 與名稱)。 */
@ObjectType()
export class RoleOrgRef {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;
}

/**
 * 角色的擁有組織(`org_role`;每個角色只屬一個組織,ADR-0003)。
 * 它同時是這個角色的**管轄邊界** — 持有者在治理模組能操作的組織 = 這個組織的整棵子樹
 * (CONTEXT.md「管理範圍」);角色管理頁的欄位提示用同一句白話。
 */
@ObjectType()
export class RoleOwnerOrg extends RoleOrgRef {
  /**
   * 擁有組織所屬的**租戶頂層**(根組織的直接子組織;`orgs.ancestors[1]`,見 `org-mapper.ts`)。
   * 根組織視角的角色選單靠它分組 —— 不同租戶各有一個「租戶管理員」,只看角色名稱分不出來。
   * 擁有組織本身就是租戶頂層時 = 它自己;擁有組織是根組織、或租戶頂層
   * 落在操作者管理範圍外(名稱不外露)時為 `null`。
   */
  @Field(() => RoleOrgRef, { nullable: true })
  tenantTop!: RoleOrgRef | null;
}

/**
 * 角色種類(判準與規則表正本 `docs/modules/role-manager.md`、程式正本 `role-rules.ts`)。
 * 由 api 依角色文件算出,前端只讀不重算。
 */
export enum RoleKind {
  /** 種子角色(`roles.isSystem` 或有 `key`):隨底座出貨,不可改名 / 矩陣唯讀 / 不可停用 / 不可刪 */
  SYSTEM = "SYSTEM",
  /** 開通租戶時複製出來的租戶管理員副本(`settings.templateKey`,ADR-0009);**UI 稱「預設角色」** */
  TEMPLATE_COPY = "TEMPLATE_COPY",
  /** 租戶自建的角色 */
  CUSTOM = "CUSTOM",
}

registerEnumType(RoleKind, {
  name: "RoleKind",
  description:
    "角色種類(種子 / 預設角色 / 自建);規則表見 docs/modules/role-manager.md",
});

/**
 * 這個角色**依種類規則**允許的四個動作,由 api 依操作者算好。
 *
 * **不含權限 key 的判斷**:「有沒有 `system.role-manager.edit`」由 `@RequirePermission`
 * 與前端的 `usePermissions` 各守一層(ADR-0011「頁內功能」)。前端顯示按鈕的條件是
 * 兩者相乘 —— `ability.canEdit && role.abilities.canEdit`,不在前端重算種類規則。
 */
@ObjectType()
export class RoleAbilities {
  /** 改名稱 / 描述(`updateRole`);種子角色為 false */
  @Field(() => Boolean)
  canEdit!: boolean;

  /** 編輯權限矩陣(`saveRoleMatrix`);種子角色唯讀。放寬 / 收窄的分野另看 `shrinkOnly` */
  @Field(() => Boolean)
  canEditMatrix!: boolean;

  /**
   * 切換停用 / 啟用(`setRoleEnabled`)。種子角色恆 false;預設角色只有根組織的操作者可以;
   * 自建角色**不可停用操作者自己正持有的**(自鎖保護,停用中的角色照樣可以啟用)。
   */
  @Field(() => Boolean)
  canToggleEnabled!: boolean;

  /** 刪除(`deleteRole`):自建角色且目前無人持有;被擋的細目仍由 `ROLE_NOT_DELETABLE` 回 */
  @Field(() => Boolean)
  canDelete!: boolean;
}

/**
 * 角色(`system.role-manager` 的主要型別)。
 *
 * api 介面(GQL-07:欄位語意的正本在此,前端段只引用):
 * - `ownerOrg`:擁有組織;清單只回擁有組織在操作者**管理範圍**內的角色,所以正常情況恆有值,
 *   資料損毀(沒有 `org_role`)時為 null。`ownerOrg.tenantTop` 供角色選單依租戶分組
 * - `kind`:角色種類;`isSystem` / `isTemplateCopy` 是它的兩個布林投影,留著相容
 * - `abilities`:這個角色依種類規則允許的四個動作,**api 依操作者算好,前端不重算**
 * - `isSystem`:種子角色(`super-admin` / `tenant-admin` 模板),不可刪除
 * - `isTemplateCopy`:開通租戶時從「租戶管理員」模板複製出來的副本(`settings.templateKey`,ADR-0009);
 *   不可刪除,且權限矩陣對**非根組織的操作者**只能縮不能擴
 * - `userCount`:被授予這個角色的人數(`user_role`),含「組織外」的授予(ADR-0003:授予照常有效)
 */
@ObjectType("Role")
export class RoleModel {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  /** 停用後持有者的該角色立即不生效(授予仍在,PermissionResolver 排除,ADR-0011)。 */
  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => RoleKind)
  kind!: RoleKind;

  @Field(() => RoleAbilities)
  abilities!: RoleAbilities;

  @Field(() => Boolean)
  isSystem!: boolean;

  @Field(() => Boolean)
  isTemplateCopy!: boolean;

  @Field(() => RoleOwnerOrg, { nullable: true })
  ownerOrg!: RoleOwnerOrg | null;

  @Field(() => Int)
  userCount!: number;
}
