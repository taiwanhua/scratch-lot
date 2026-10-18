import { Field, ID, Int, ObjectType } from "@nestjs/graphql";

import { ModuleSidebarType } from "../../permission/models/me-module.model";
import { RoleModel } from "./role.model";

/** 矩陣上一列權限(縮排列於其擁有模組之下);`<模組key>.*` 是每個模組固定的「全部」那一列。 */
@ObjectType()
export class RoleMatrixPermission {
  @Field(() => ID)
  id!: string;

  /** 權限 key(`<擁有模組 key>.<動作>`,ADR-0004)。 */
  @Field(() => String)
  key!: string;

  @Field(() => String)
  name!: string;

  /** 矩陣 hover 的補充說明。 */
  @Field(() => String, { nullable: true })
  description!: string | null;

  /** 動作段(`*` = 這一層的「全部」列,與同層權限互斥連動)。 */
  @Field(() => String)
  action!: string;
}

/**
 * 矩陣的模組樹節點(ADR-0004「模組樹是權限的命名空間」)。
 * `permissions` 只放**自己這一層**的權限(同層語意);子模組的權限在 `children` 各自的節點上。
 */
@ObjectType()
export class RoleMatrixModule {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  key!: string;

  @Field(() => String)
  name!: string;

  @Field(() => ID, { nullable: true })
  parentId!: string | null;

  @Field(() => ModuleSidebarType)
  sidebarType!: ModuleSidebarType;

  @Field(() => Int)
  order!: number;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => [RoleMatrixPermission])
  permissions!: RoleMatrixPermission[];

  @Field(() => [RoleMatrixModule])
  children!: RoleMatrixModule[];
}

/**
 * 一份授予(`role_module` + `role_permission`);形狀與 `@repo/domain/permission` 的
 * `PermissionGrant` 一致,前端直接餵進 `normalizeGrant` / `toggleWholeGroup` 做勾選連動。
 */
@ObjectType()
export class RoleGrant {
  @Field(() => [String])
  moduleKeys!: string[];

  @Field(() => [String])
  permissionKeys!: string[];
}

/**
 * 權限矩陣(`roleMatrix` / `saveRoleMatrix` 共用的回傳)。
 *
 * api 介面(GQL-07:欄位語意的正本在此):
 * - `modules`:**操作者授得出去的那棵樹** — 全樹先剔除停用的模組(連子樹)與停用的權限(ADR-0011),
 *   再交集操作者自己的有效權限集(ADR-0004 防越權:只能授出自身有的;超級管理員 = 全部)。
 *   矩陣上沒出現的東西就是勾不到的東西,UI 不必自己再算一次防越權
 * - `granted`:這個角色**在這棵樹內**目前的綁定(`*` 維持單筆,不展開;要展開給 UI 用
 *   `expandGrant`)。樹外(操作者觸及不到)的既有綁定不列出,`saveRoleMatrix` 也不動它們
 * - `shrinkOnly`:這個角色是租戶管理員副本,矩陣只能縮不能擴(ADR-0009)
 * - `ceiling`:預設角色(租戶副本)的**天花板** —— 內建「租戶管理員」模板角色目前的授予,
 *   展開後收到顯示樹內;其他種類的角色為 `null`
 */
@ObjectType()
export class RoleMatrixPayload {
  @Field(() => RoleModel)
  role!: RoleModel;

  @Field(() => [RoleMatrixModule])
  modules!: RoleMatrixModule[];

  @Field(() => RoleGrant)
  granted!: RoleGrant;

  /**
   * 租戶管理員副本(ADR-0009):矩陣**只能縮不能擴** —
   * 送出的授予必須是目前綁定的子集,否則 `ROLE_OUT_OF_REACH`。前端據此提示。
   */
  @Field(() => Boolean)
  shrinkOnly!: boolean;

  /**
   * 預設角色(租戶副本)的矩陣上限:**內建「租戶管理員」模板角色目前的授予**,
   * 已展開 `*`(同 `granted`)並收到顯示樹內。root 可在此範圍內放寬與收窄,
   * 非 root 另受 `shrinkOnly` 限制;超出 → `ROLE_OUT_OF_REACH` + `reason TEMPLATE_CEILING`。
   * 不是預設角色時為 `null` —— 前端據此決定要不要把天花板外的列鎖住。
   */
  @Field(() => RoleGrant, { nullable: true })
  ceiling!: RoleGrant | null;
}
