import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import {
  type OrgDocument,
  OrgsRepository,
  type UserDocument,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { UsersService } from "../users/users.service";
import type { AddOrgMembersInput } from "./dto/add-org-members.input";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type OrgMembersInput,
} from "./dto/org-members.input";
import type {
  AddOrgMembersPayload,
  OrgMember,
  OrgMemberOrg,
  OrgMembersPayload,
} from "./models/org-member.model";
import { orgError } from "./org-error";

type OrgRecord = Persisted<OrgDocument>;
type UserRecord = Persisted<UserDocument>;

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值(與使用者清單同一套欄位)。 */
function keywordConditions(keyword: string): Record<string, unknown>[] {
  const escaped = keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return ["name", "account", "email"].map((field) => ({
    [field]: { $regex: escaped, $options: "i" },
  }));
}

/**
 * 組織的「成員」頁籤與「加入成員」(權限 `system.org-manager.view-members` /
 * `.add-members`,正本 docs/modules/org-manager.md 權限表)。
 *
 * 三條規則,都不是本模組自創的:
 * - **範圍**:組織一律經 `this.orgs`(治理類 collection,過濾自動吃 `managedOrgIds`,ADR-0005),
 *   查不到即 `NOT_FOUND` —— 「範圍外視為不存在」與 `org(id)` 同一條
 * - **清單是這個組織自己的直接成員**(`org_user`),不含下層組織的成員:加入成員加的就是
 *   一筆直接關聯,列表要跟它對得起來。要看整棵子樹的人是使用者管理的 `users(input:{orgId})`
 * - **寫入沿用使用者管理那一支**(`UsersService.addOrgs`):被改的是使用者的所屬組織,
 *   資格判斷(組織 / 使用者都要在管理範圍內)與稽核(`user.add-org`)因此只有一份
 *
 * **候選清單要套管理範圍**(與 `roleUserCandidates` 同一個理由):那是
 * 「還沒加入、可以加誰」的問題,答案不該超出操作者管得到的人。
 */
@Injectable()
export class OrgMembersService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly relations: RelationService,
    private readonly usersService: UsersService,
  ) {}

  /** 這個組織自己的成員(分頁);每筆附「本組織以外的所屬組織」。 */
  async list(
    operator: OperatorContext,
    orgId: string,
    input: OrgMembersInput,
  ): Promise<OrgMembersPayload> {
    const org = await this.loadManagedOrg(operator, orgId);
    const memberIds = await this.memberIdsOf(org);
    return this.page(operator, org, memberIds, input);
  }

  /**
   * 「加入成員」彈窗的候選:操作者**管理範圍**內、**尚未加入**這個組織的使用者。
   *
   * 掛在 `system.org-manager.add-members` 底下而不是借 `users` —— 借了會逼得這個彈窗
   * 連帶需要 `system.user-manager.view`,能管組織的人卻打不開它(角色那邊踩過同一個坑),
   * 而且排不掉已經是成員的人。
   */
  async candidates(
    operator: OperatorContext,
    orgId: string,
    input: OrgMembersInput,
  ): Promise<OrgMembersPayload> {
    const org = await this.loadManagedOrg(operator, orgId);
    const memberIds = await this.memberIdsOf(org);
    const members = new Set(memberIds.map(String));
    const managedUserIds = await this.managedUserIds(operator);
    const candidateIds = managedUserIds.filter(
      (userId) => !members.has(String(userId)),
    );
    return this.page(operator, org, candidateIds, input);
  }

  /**
   * 加入成員(增量):把選中的使用者各加一筆所屬組織。
   * 寫入、資格判斷與稽核都在 `UsersService.addOrgs`(不繞過使用者管理那一套);
   * 這裡只負責把「組織在不在管理範圍內」翻成 `NOT_FOUND`(與讀取端同一個答案)。
   */
  async add(
    operator: OperatorContext,
    input: AddOrgMembersInput,
  ): Promise<AddOrgMembersPayload> {
    const org = await this.loadManagedOrg(operator, input.orgId);
    return this.usersService.addOrgs(operator, {
      orgId: String(org._id),
      userIds: input.userIds,
    });
  }

  // ---- 內部 ----

  /** 組織必須在操作者**管理範圍**內;否則視為不存在(不透露差別,與 `org(id)` 同一條)。 */
  private async loadManagedOrg(
    operator: OperatorContext,
    orgId: string,
  ): Promise<OrgRecord> {
    if (!Types.ObjectId.isValid(orgId)) {
      throw orgError("VALIDATION_FAILED", `orgId is not a valid id: ${orgId}`);
    }
    const org = await this.orgs.findById(operator, new Types.ObjectId(orgId));
    if (!org) {
      throw orgError("NOT_FOUND", `Org ${orgId} not found`);
    }
    return org;
  }

  /** 這個組織的直接成員 id(`org_user`,不含下層組織)。 */
  private async memberIdsOf(org: OrgRecord): Promise<Types.ObjectId[]> {
    const links = await this.relations.listLinks("org_user", {
      firstIds: [org._id],
    });
    return links.map((link) => link.secondId);
  }

  /**
   * 操作者**管理範圍**內的使用者 id(治理模組的範圍,ADR-0005 的分工表):
   * 組織一律經 `this.orgs`(治理類,過濾自動生效)再反查 `org_user` —— 寫法同
   * `RoleUsersService.managedUserIds`,本檔不自己比對任何組織集合。
   */
  private async managedUserIds(
    operator: OperatorContext,
  ): Promise<Types.ObjectId[]> {
    const managedOrgs = await this.orgs.findMany(operator, {});
    if (managedOrgs.length === 0) {
      return [];
    }
    const links = await this.relations.listLinks("org_user", {
      firstIds: managedOrgs.map((one) => one._id),
    });
    return [
      ...new Map(links.map((link) => [String(link.secondId), link.secondId])),
    ].map(([, id]) => id);
  }

  /** 取一頁並組成 GraphQL 形狀(成員與候選共用:兩邊的列完全同形)。 */
  private async page(
    operator: OperatorContext,
    org: OrgRecord,
    userIds: Types.ObjectId[],
    input: OrgMembersInput,
  ): Promise<OrgMembersPayload> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE),
    );
    if (userIds.length === 0) {
      return { items: [], totalCount: 0, page, pageSize };
    }
    const keyword = input.keyword?.trim();
    // users 本身不掛租戶過濾(歸屬走 org_user 關聯,ADR-0005),範圍已由 id 清單框住
    const filter = {
      _id: { $in: userIds },
      ...(keyword === undefined || keyword === ""
        ? {}
        : { $or: keywordConditions(keyword) }),
    };
    const totalCount = await this.users.count(operator, filter);
    const documents = await this.users.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });
    return {
      items: await this.decorate(operator, org, documents),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 每列附「本組織以外的所屬組織」,只列操作者管理範圍內的(範圍外不露名稱也不露 id)。 */
  private async decorate(
    operator: OperatorContext,
    org: OrgRecord,
    documents: UserRecord[],
  ): Promise<OrgMember[]> {
    if (documents.length === 0) {
      return [];
    }
    const orgLinks = await this.relations.listLinks("org_user", {
      secondIds: documents.map((user) => user._id),
    });
    const otherOrgIds = [
      ...new Map(
        orgLinks
          .filter((link) => !link.firstId.equals(org._id))
          .map((link) => [String(link.firstId), link.firstId]),
      ),
    ].map(([, id]) => id);
    const managedOrgs =
      otherOrgIds.length === 0
        ? []
        : await this.orgs.findMany(operator, { _id: { $in: otherOrgIds } });
    const orgNameById = new Map(
      managedOrgs.map((one) => [String(one._id), one.name]),
    );
    const orgIdsByUser = new Map<string, string[]>();
    for (const link of orgLinks) {
      if (link.firstId.equals(org._id)) {
        continue;
      }
      const key = String(link.secondId);
      orgIdsByUser.set(key, [
        ...(orgIdsByUser.get(key) ?? []),
        String(link.firstId),
      ]);
    }

    return documents.map((user) => ({
      id: String(user._id),
      account: user.account,
      name: user.name,
      enabled: user.enabled,
      otherOrgs: (orgIdsByUser.get(String(user._id)) ?? []).flatMap(
        (orgId): OrgMemberOrg[] => {
          const name = orgNameById.get(orgId);
          return name === undefined ? [] : [{ id: orgId, name }];
        },
      ),
    }));
  }
}
