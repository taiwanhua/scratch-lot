import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import type { Persisted } from "../database/base.repository";
import {
  OrgsRepository,
  type UserDocument,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { TransactionService } from "../database/transaction";
import { OwnerProtectionService } from "../orgs/owner-protection.service";
import { OrgQualificationService } from "../users/org-qualification.service";
import type { GrantRoleUsersInput } from "./dto/grant-role-users.input";
import type { RevokeRoleUsersInput } from "./dto/revoke-role-users.input";
import type { RoleUserCandidatesInput } from "./dto/role-user-candidates.input";
import type { RoleUsersInput } from "./dto/role-users.input";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./dto/roles.input";
import type {
  RoleUser,
  RoleUserCandidate,
  RoleUserCandidatesPayload,
  RoleUserOrg,
  RoleUsersPayload,
} from "./models/role-payloads.model";
import {
  type RoleRecord,
  RoleScopeService,
  toObjectId,
  uniqueIds,
  uniqueObjectIds,
} from "./role-scope.service";
import { notFoundError, roleError } from "./roles-error";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPE } from "./roles.service";

type UserRecord = Persisted<UserDocument>;

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值(與使用者清單同一套欄位)。 */
function keywordConditions(keyword: string): Record<string, unknown>[] {
  const escaped = keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return ["name", "account", "email"].map((field) => ({
    [field]: { $regex: escaped, $options: "i" },
  }));
}

/**
 * 分配使用者頁籤(`system.role-manager.assign-users`)。
 *
 * 三條規則,都不是本模組自創的:
 * - **候選**(ADR-0003「被授予角色的資格」):使用者的所屬組織至少一個落在角色擁有組織的子樹內;
 *   判斷共用 `OrgQualificationService`(使用者管理的「組織外」標記、移除所屬組織的 dry-run
 *   用的是同一支),不在此另寫一份
 * - **組織外**(ADR-0003):失去子樹支撐的授予照常有效,只標記不解除
 * - **擁有者保護**(ADR-0009):租戶擁有者的「租戶管理員」授予不可解除,根組織操作者例外;
 *   判斷共用 `OwnerProtectionService`
 *
 * 清單不套管理範圍:角色本身已經在操作者的管理範圍內(`RoleScopeService`),
 * 而持有者可能因為被移出組織而落在範圍外(ADR-0003「組織外」)— 列不出來就移不掉。
 * 使用者的**所屬組織名稱**仍只露管理範圍內的(`this.orgs` 是治理類,過濾自動生效)。
 *
 * **候選清單(`candidates`)剛好相反,要套管理範圍**:那是「還沒授予、可以授予誰」的問題,
 * 答案不該超出操作者管得到的人。不合格的候選照列但標 `eligible: false`。
 */
@Injectable()
export class RoleUsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
    private readonly audit: AuditService,
    private readonly scope: RoleScopeService,
    private readonly qualification: OrgQualificationService,
    private readonly ownerProtection: OwnerProtectionService,
    private readonly transactions: TransactionService,
  ) {}

  /** 被授予這個角色的使用者(分頁);每筆附「組織外」與擁有者保護標記。 */
  async list(
    operator: OperatorContext,
    roleId: string,
    input: RoleUsersInput,
  ): Promise<RoleUsersPayload> {
    const role = await this.scope.loadManagedRole(operator, roleId);
    return this.payload(operator, role, input);
  }

  /**
   * 「加入使用者」彈窗的候選清單:操作者**管理範圍**內、**尚未持有**這個角色的
   * 使用者,每筆附 `eligible`(所屬組織是否落在角色擁有組織的子樹內,ADR-0003)。
   *
   * 掛在 `system.role-manager.assign-users` 底下:在此之前前端借 `users(input:{orgId})`,
   * 逼得分配使用者彈窗連帶需要 `system.user-manager.view`,而且排不掉已持有者。
   *
   * 管理範圍的落實點只有一個:成員清單經 `this.orgs`(治理類 collection,過濾自動吃
   * `managedOrgIds`)反查 `org_user`,本方法不自己比對任何組織集合。
   * 資格判斷共用 `OrgQualificationService`(與 `grantRoleUsers` 同一份),不另寫一套。
   */
  async candidates(
    operator: OperatorContext,
    roleId: string,
    input: RoleUserCandidatesInput,
  ): Promise<RoleUserCandidatesPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const empty = { items: [], totalCount: 0, page, pageSize };
    const role = await this.scope.loadManagedRole(operator, roleId);
    const managedUserIds = await this.managedUserIds(operator);
    if (managedUserIds.length === 0) {
      return empty;
    }
    const holderIds = await this.relations.listUserIdsOfRole(role._id);
    const holders = new Set(holderIds.map(String));
    const candidateIds = managedUserIds.filter(
      (userId) => !holders.has(String(userId)),
    );
    if (candidateIds.length === 0) {
      return empty;
    }

    const keyword = input.keyword?.trim();
    const filter = {
      _id: { $in: candidateIds },
      ...(keyword ? { $or: keywordConditions(keyword) } : {}),
    };
    const totalCount = await this.users.count(operator, filter);
    const documents = await this.users.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.decorateCandidates(operator, role, documents),
      totalCount,
      page,
      pageSize,
    };
  }

  /**
   * 加入使用者(增量):候選 = 所屬組織在角色擁有組織子樹內,否則 `USER_NOT_ELIGIBLE`。
   * 已持有者重送不報錯(冪等),不計入稽核。
   * 讀取驗證、授予與稽核一個交易(TX-01);回傳的清單在提交後讀。
   */
  async grant(
    operator: OperatorContext,
    input: GrantRoleUsersInput,
  ): Promise<RoleUsersPayload> {
    const role = await this.transactions.withTransaction(async () => {
      const managed = await this.scope.loadManagedRole(operator, input.roleId);
      const ownerOrgId = await this.scope.ownerOrgIdOf(managed);
      const userIds = uniqueIds(input.userIds).map((id) =>
        toObjectId(id, "userIds"),
      );
      const holderIds = await this.relations.listUserIdsOfRole(managed._id);
      const holders = new Set(holderIds.map(String));
      const toAdd = userIds.filter((userId) => !holders.has(String(userId)));
      if (toAdd.length > 0) {
        await this.assertEligible(operator, toAdd, managed._id, ownerOrgId);
        await this.relations.linkMany(
          operator,
          toAdd.map((userId) => ({
            type: "user_role" as const,
            firstId: userId,
            secondId: managed._id,
          })),
        );
        await this.audit.record(operator, {
          action: AUDIT_ACTIONS.grantUser,
          targetType: AUDIT_TARGET_TYPE,
          targetId: managed._id,
          after: { userIds: toAdd.map(String) },
        });
      }
      return managed;
    });
    return this.payload(operator, role, {});
  }

  /**
   * 移除授予:擁有者保護(ADR-0009)擋下租戶擁有者的「租戶管理員」授予;
   * 沒有這筆授予的人重送不報錯(冪等)。
   * 讀取驗證、解除與稽核一個交易(TX-01);回傳的清單在提交後讀。
   */
  async revoke(
    operator: OperatorContext,
    input: RevokeRoleUsersInput,
  ): Promise<RoleUsersPayload> {
    const role = await this.transactions.withTransaction(async () => {
      const managed = await this.scope.loadManagedRole(operator, input.roleId);
      const userIds = uniqueIds(input.userIds).map((id) =>
        toObjectId(id, "userIds"),
      );
      const holderIds = await this.relations.listUserIdsOfRole(managed._id);
      const holders = new Set(holderIds.map(String));
      const toRemove = userIds.filter((userId) => holders.has(String(userId)));
      if (toRemove.length > 0) {
        await this.assertNotOwnerProtected(operator, toRemove, managed._id);
        await this.relations.unlinkMany(
          operator,
          toRemove.map((userId) => ({
            type: "user_role" as const,
            firstId: userId,
            secondId: managed._id,
          })),
        );
        await this.audit.record(operator, {
          action: AUDIT_ACTIONS.revokeUser,
          targetType: AUDIT_TARGET_TYPE,
          targetId: managed._id,
          after: { userIds: toRemove.map(String) },
        });
      }
      return managed;
    });
    return this.payload(operator, role, {});
  }

  // ---- 內部 ----

  /**
   * 操作者**管理範圍**內的使用者 id(治理模組的範圍,ADR-0005 的分工表):
   * 組織一律經 `this.orgs`(治理類,過濾自動生效)再反查 `org_user` —— 所以
   * 「沒有所屬組織的人」不在候選內,他本來就不可能有資格(ADR-0003)。
   */
  private async managedUserIds(
    operator: OperatorContext,
  ): Promise<Types.ObjectId[]> {
    const managedOrgs = await this.orgs.findMany(operator, {});
    if (managedOrgs.length === 0) {
      return [];
    }
    const links = await this.relations.listLinks("org_user", {
      firstIds: managedOrgs.map((org) => org._id),
    });
    return uniqueObjectIds(links.map((link) => link.secondId));
  }

  /** 候選列:所屬組織(只列管理範圍內的)+ `eligible`(資格判斷共用 `OrgQualificationService`)。 */
  private async decorateCandidates(
    operator: OperatorContext,
    role: RoleRecord,
    documents: UserRecord[],
  ): Promise<RoleUserCandidate[]> {
    if (documents.length === 0) {
      return [];
    }
    const ownerOrgId = await this.scope.ownerOrgIdOf(role);
    const orgLinks = await this.relations.listLinks("org_user", {
      secondIds: documents.map((user) => user._id),
    });
    const allOrgIds = uniqueObjectIds([
      ...orgLinks.map((link) => link.firstId),
      ...(ownerOrgId === null ? [] : [ownerOrgId]),
    ]);
    const [ancestry, managedOrgs] = await Promise.all([
      this.qualification.loadAncestry(operator, allOrgIds),
      this.orgs.findMany(operator, { _id: { $in: allOrgIds } }),
    ]);
    const orgNameById = new Map(
      managedOrgs.map((org) => [String(org._id), org.name]),
    );
    const memberOrgIdsByUser = new Map<string, string[]>();
    for (const link of orgLinks) {
      const key = String(link.secondId);
      memberOrgIdsByUser.set(key, [
        ...(memberOrgIdsByUser.get(key) ?? []),
        String(link.firstId),
      ]);
    }

    return documents.map((user) => {
      const memberOrgIds = memberOrgIdsByUser.get(String(user._id)) ?? [];
      return {
        id: String(user._id),
        account: user.account,
        name: user.name,
        email: user.email,
        enabled: user.enabled,
        orgs: memberOrgIds.flatMap((orgId): RoleUserOrg[] => {
          const name = orgNameById.get(orgId);
          return name === undefined ? [] : [{ id: orgId, name }];
        }),
        eligible: this.qualification.qualifies(
          memberOrgIds,
          ownerOrgId === null ? null : String(ownerOrgId),
          ancestry,
        ),
      };
    });
  }

  private async payload(
    operator: OperatorContext,
    role: RoleRecord,
    input: RoleUsersInput,
  ): Promise<RoleUsersPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    const roleModel = await this.scope.decorateOne(operator, role);
    const holderIds = await this.relations.listUserIdsOfRole(role._id);
    if (holderIds.length === 0) {
      return { role: roleModel, items: [], totalCount: 0, page, pageSize };
    }
    // 持有者可能落在管理範圍外(ADR-0003「組織外」),所以不套 users 的範圍條件;
    // users 本身不掛租戶過濾(歸屬走 org_user 關聯,ADR-0005),此處以 id 明列。
    const filter = { _id: { $in: holderIds } };
    const totalCount = await this.users.count(operator, filter);
    const documents = await this.users.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      role: roleModel,
      items: await this.decorate(operator, role, documents),
      totalCount,
      page,
      pageSize,
    };
  }

  private async decorate(
    operator: OperatorContext,
    role: RoleRecord,
    documents: UserRecord[],
  ): Promise<RoleUser[]> {
    if (documents.length === 0) {
      return [];
    }
    const ownerOrgId = await this.scope.ownerOrgIdOf(role);
    const userIds = documents.map((user) => user._id);
    const orgLinks = await this.relations.listLinks("org_user", {
      secondIds: userIds,
    });
    const allOrgIds = uniqueObjectIds([
      ...orgLinks.map((link) => link.firstId),
      ...(ownerOrgId === null ? [] : [ownerOrgId]),
    ]);
    const [ancestry, managedOrgs] = await Promise.all([
      this.qualification.loadAncestry(operator, allOrgIds),
      allOrgIds.length === 0
        ? Promise.resolve([])
        : this.orgs.findMany(operator, { _id: { $in: allOrgIds } }),
    ]);
    const orgNameById = new Map(
      managedOrgs.map((org) => [String(org._id), org.name]),
    );
    const memberOrgIdsByUser = new Map<string, string[]>();
    for (const link of orgLinks) {
      const key = String(link.secondId);
      memberOrgIdsByUser.set(key, [
        ...(memberOrgIdsByUser.get(key) ?? []),
        String(link.firstId),
      ]);
    }
    const protectedUserIds = await this.protectedHolderIds(
      operator,
      documents,
      role._id,
    );

    return documents.map((user) => {
      const key = String(user._id);
      const memberOrgIds = memberOrgIdsByUser.get(key) ?? [];
      return {
        id: key,
        account: user.account,
        name: user.name,
        email: user.email,
        enabled: user.enabled,
        orgs: memberOrgIds.flatMap((orgId): RoleUserOrg[] => {
          const name = orgNameById.get(orgId);
          return name === undefined ? [] : [{ id: orgId, name }];
        }),
        outOfScope: !this.qualification.qualifies(
          memberOrgIds,
          ownerOrgId === null ? null : String(ownerOrgId),
          ancestry,
        ),
        ownerProtected: protectedUserIds.has(key),
      };
    });
  }

  /** 這一頁裡,哪些人的這筆授予受擁有者保護(根組織操作者不受限 → 空集合)。 */
  private async protectedHolderIds(
    operator: OperatorContext,
    documents: UserRecord[],
    roleId: Types.ObjectId,
  ): Promise<Set<string>> {
    if (await this.ownerProtection.isRootOperator(operator)) {
      return new Set();
    }
    // 整頁一次判斷(TX-07),不逐人查
    return this.ownerProtection.protectedHoldersOf(
      operator,
      documents.map((user) => user._id),
      roleId,
    );
  }

  /**
   * 候選規則(ADR-0003):所屬組織至少一個落在角色擁有組織的子樹內。
   * 查不到的使用者一律 `NOT_FOUND`(不透露差別);資格判斷本身共用
   * `OrgQualificationService.assertEligible`(與使用者頁的 `assignUserRoles`
   * 同一份判斷、同一個 `USER_NOT_ELIGIBLE`),本檔不自己再算一次。
   */
  private async assertEligible(
    operator: OperatorContext,
    userIds: Types.ObjectId[],
    roleId: Types.ObjectId,
    ownerOrgId: Types.ObjectId | null,
  ): Promise<void> {
    const found = await this.users.findMany(operator, {
      _id: { $in: userIds },
    });
    if (found.length !== userIds.length) {
      throw notFoundError("One or more users not found");
    }
    await this.qualification.assertEligible(
      operator,
      await this.qualification.loadMembers(userIds),
      [{ id: roleId, ownerOrgId }],
    );
  }

  /** 擁有者保護(ADR-0009):租戶擁有者的「租戶管理員」授予不可解除;根組織操作者放行。 */
  private async assertNotOwnerProtected(
    operator: OperatorContext,
    userIds: Types.ObjectId[],
    roleId: Types.ObjectId,
  ): Promise<void> {
    if (await this.ownerProtection.isRootOperator(operator)) {
      return;
    }
    // 一次判斷整批(TX-06),不逐人查;錯誤訊息不帶使用者,哪一位先擋都一樣
    const protectedIds = await this.ownerProtection.protectedHoldersOf(
      operator,
      userIds,
      roleId,
    );
    if (protectedIds.size > 0) {
      throw roleError(
        "OWNER_PROTECTED",
        `Role ${String(roleId)} is the tenant owner's tenant-admin grant and cannot be revoked outside the root org`,
      );
    }
  }
}
