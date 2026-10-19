import { Field, ID, Int, ObjectType, registerEnumType } from "@nestjs/graphql";

import { UserModel as User, UserOrg } from "./user.model";

/** 「失去資格」的原因(ADR-0003;dry-run 逐筆附原因,前端在確認彈窗列出)。 */
export enum RoleUnqualifiedReason {
  /** 該角色的擁有組織正是被移除的所屬組織之一。 */
  OWNED_BY_REMOVED_ORG = "OWNED_BY_REMOVED_ORG",
  /** 移除後剩餘的所屬組織皆不在該角色擁有組織的子樹內(失去全部子樹支撐)。 */
  NO_REMAINING_SUBTREE_SUPPORT = "NO_REMAINING_SUBTREE_SUPPORT",
}

registerEnumType(RoleUnqualifiedReason, {
  name: "RoleUnqualifiedReason",
  description: "所屬組織移除後角色失去資格的原因(ADR-0003)",
});

/** 移除所屬組織時要如何處理失去資格的角色(ADR-0003「從組織移除使用者」的 radio 三檔)。 */
export enum UserOrgRemovalPolicy {
  /** (a) 全部保留:不解除任何授予。 */
  KEEP_ALL = "KEEP_ALL",
  /** (b) 解除被移除組織擁有的角色。 */
  REVOKE_OWNED_BY_ORG = "REVOKE_OWNED_BY_ORG",
  /** (c) 解除所有失去資格的角色(= 該組織擁有的 + 失去全部子樹支撐的);彈窗預設。 */
  REVOKE_ALL_UNQUALIFIED = "REVOKE_ALL_UNQUALIFIED",
}

registerEnumType(UserOrgRemovalPolicy, {
  name: "UserOrgRemovalPolicy",
  description: "移除所屬組織時角色授予的處理方式(ADR-0003,radio 三檔)",
});

/** 新增使用者的啟用方式二選一(ADR-0009)。 */
export enum UserActivationMode {
  /** 預設:不設密碼,寄 7 天有效的啟用信,使用者自行設定。 */
  EMAIL = "EMAIL",
  /** 操作者直接設定初始密碼,`mustChangePassword = true`,首登強制改。 */
  PASSWORD = "PASSWORD",
}

registerEnumType(UserActivationMode, {
  name: "UserActivationMode",
  description: "新增使用者的啟用方式(ADR-0009:啟用信 / 初始密碼)",
});

/** 清單分頁(形狀同 GQL-03:`items` + `totalCount`;分頁參數用 page / pageSize)。 */
@ObjectType()
export class UsersPayload {
  @Field(() => [User])
  items!: User[];

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  pageSize!: number;
}

/** 單一使用者的寫入結果(GQL-02:mutation 一律回 payload type)。 */
@ObjectType()
export class UserPayload {
  @Field(() => User)
  user!: User;
}

/** dry-run 逐筆列出的失去資格角色。 */
@ObjectType()
export class UnqualifiedRole {
  @Field(() => ID)
  roleId!: string;

  @Field(() => String)
  roleName!: string;

  @Field(() => ID, { nullable: true })
  ownerOrgId!: string | null;

  @Field(() => String, { nullable: true })
  ownerOrgName!: string | null;

  /** 同一筆可能同時符合兩種原因(擁有組織被移除、且剩餘所屬組織不在其子樹內)。 */
  @Field(() => [RoleUnqualifiedReason])
  reasons!: RoleUnqualifiedReason[];

  /**
   * 擁有者保護(ADR-0009):這筆是租戶擁有者的「租戶管理員」授予,
   * 即使選 (b) / (c) 也不會被解除(根組織操作者不受此限)。
   */
  @Field(() => Boolean)
  ownerProtected!: boolean;
}

/**
 * 所屬組織變更的結果。`dryRun = true` 時只算不寫:`removedOrgs` 與 `unqualifiedRoles`
 * 供「確認所屬組織變更」彈窗顯示,`revokedRoleIds` 為空、`user` 是未變更前的樣子。
 */
@ObjectType()
export class SetUserOrgsPayload {
  @Field(() => User)
  user!: User;

  @Field(() => [UserOrg])
  removedOrgs!: UserOrg[];

  @Field(() => [UnqualifiedRole])
  unqualifiedRoles!: UnqualifiedRole[];

  /** 實際解除的角色授予(依 `removalPolicy`);`dryRun` 時恆為空。 */
  @Field(() => [ID])
  revokedRoleIds!: string[];
}
