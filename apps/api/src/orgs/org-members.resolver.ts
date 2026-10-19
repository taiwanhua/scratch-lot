import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AddOrgMembersInput } from "./dto/add-org-members.input";
import { OrgMembersInput } from "./dto/org-members.input";
import {
  AddOrgMembersPayload,
  OrgMembersPayload,
} from "./models/org-member.model";
import { OrgMembersService } from "./org-members.service";

/** 權限 key(docs/modules/org-manager.md 權限表;種子 apps/db-migrator/seeds/base/modules/system.ts)。 */
const PERMISSIONS = {
  viewMembers: "system.org-manager.view-members",
  addMembers: "system.org-manager.add-members",
} as const;

/**
 * 組織詳情的「成員」頁籤:resolver 薄,規則全在 `OrgMembersService`。
 *
 * 兩筆權限都屬**組織管理這一層**(不是 `tenant-ops`):看自己組織裡有誰、把人加進來
 * 是租戶管理員本來就該做的事,租戶管理員模板靠 `system.org-manager.*` 自動取得。
 * 清單的實體 id 是獨立參數、不進 input(GQL-03,先例 `roleUsers`)。
 */
@Resolver()
export class OrgMembersResolver {
  constructor(private readonly members: OrgMembersService) {}

  /** 這個組織自己的成員(不含下層組織的成員;那是使用者管理的 `users`)。 */
  @RequirePermission(PERMISSIONS.viewMembers)
  @Query(() => OrgMembersPayload)
  orgMembers(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("input") input: OrgMembersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgMembersPayload> {
    return this.members.list(operator, orgId, input);
  }

  /**
   * 「加入成員」彈窗的候選:管理範圍內、尚未加入這個組織的使用者。
   * 守在 `add-members` 底下 —— 只看得到成員的人不需要候選清單,
   * 而借 `users` 會讓這個彈窗連帶需要 `system.user-manager.view`(角色管理那邊的教訓)。
   */
  @RequirePermission(PERMISSIONS.addMembers)
  @Query(() => OrgMembersPayload)
  orgMemberCandidates(
    @Args("orgId", { type: () => ID }) orgId: string,
    @Args("input") input: OrgMembersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<OrgMembersPayload> {
    return this.members.candidates(operator, orgId, input);
  }

  /** 加入成員(增量):寫入與稽核沿用使用者管理的所屬組織那一支,見 `OrgMembersService.add`。 */
  @RequirePermission(PERMISSIONS.addMembers)
  @Mutation(() => AddOrgMembersPayload)
  addOrgMembers(
    @Args("input") input: AddOrgMembersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<AddOrgMembersPayload> {
    return this.members.add(operator, input);
  }
}
