import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { OrgsRepository, UsersRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";

/**
 * 審核流程內部讀取用的上下文:兩個範圍放開為 `"all"`,**只准搭配把查詢釘在某個租戶內的條件**
 * (租戶子樹的組織、該租戶的使用者 / 角色 id)。背景推進沒有操作者,審核者解析與「是否仍在本租戶」
 * 以整棵租戶子樹為準,不看誰在操作(理由同 `orgs/org-managers.service.ts` 的 `systemContext`)。
 */
export function systemContext(
  actorId: Types.ObjectId | null = null,
): OperatorContext {
  return {
    actorId,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
  };
}

/** 字串 id 陣列 → ObjectId(不合法的略過)。 */
export function objectIdsOf(ids: readonly string[]): Types.ObjectId[] {
  return ids
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
}

/**
 * 「本租戶的人 / 角色」的判斷(Spec 6b §5「審核者來源」:只算啟用中且仍在本租戶的使用者):
 * 審核者解析、改派資格、定義檢查器的使用者 / 角色目錄、審核者失效 hook 共用這一份。
 * 「在本租戶」= 所屬組織(`org_user`)至少有一個在租戶子樹(租戶頂層 + 所有下層)內。
 */
@Injectable()
export class TenantDirectoryService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly relations: RelationService,
  ) {}

  /** 租戶子樹的組織 id(租戶頂層 + 所有下層,不含已刪除)。 */
  async tenantOrgIds(tenantId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const orgs = await this.orgs.findMany(systemContext(), {
      $or: [{ _id: tenantId }, { ancestors: tenantId }],
    });
    return orgs.map((org) => org._id);
  }

  /** 同上,字串 id 的集合(檢查人員條件裡指定的組織屬不屬本租戶)。 */
  async tenantOrgIdSet(tenantId: Types.ObjectId): Promise<Set<string>> {
    const ids = await this.tenantOrgIds(tenantId);
    return new Set(ids.map(String));
  }

  /** 租戶子樹的成員 id(`org_user`,去重)。 */
  async memberIds(tenantId: Types.ObjectId): Promise<Set<string>> {
    const links = await this.relations.listLinks("org_user", {
      firstIds: await this.tenantOrgIds(tenantId),
    });
    return new Set(links.map((link) => String(link.secondId)));
  }

  /** 這些人裡啟用中、且仍在本租戶的。 */
  async eligibleUserIds(
    tenantId: Types.ObjectId,
    candidateIds: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) {
      return new Set();
    }
    const members = await this.memberIds(tenantId);
    const enabled = await this.users.findMany(systemContext(), {
      _id: { $in: [...candidateIds] },
      enabled: true,
    });
    return new Set(
      enabled.map((user) => String(user._id)).filter((id) => members.has(id)),
    );
  }

  async isEligible(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<boolean> {
    const eligible = await this.eligibleUserIds(tenantId, [userId]);
    return eligible.has(String(userId));
  }

  /** 定義檢查器的使用者目錄:本租戶的成員(不在目錄裡 = 不存在或不在本租戶)。 */
  async userFacts(
    tenantId: Types.ObjectId,
    candidateIds: readonly string[],
  ): Promise<Map<string, { isEnabled: boolean }>> {
    const ids = objectIdsOf(candidateIds);
    if (ids.length === 0) {
      return new Map();
    }
    const members = await this.memberIds(tenantId);
    const users = await this.users.findMany(systemContext(), {
      _id: { $in: ids },
    });
    return new Map(
      users
        .filter((user) => members.has(String(user._id)))
        .map((user) => [String(user._id), { isEnabled: user.enabled }]),
    );
  }

  /** 本租戶的角色(擁有組織在租戶子樹內,`org_role`)。 */
  async tenantRoleIds(tenantId: Types.ObjectId): Promise<Set<string>> {
    const links = await this.relations.listLinks("org_role", {
      firstIds: await this.tenantOrgIds(tenantId),
    });
    return new Set(links.map((link) => String(link.secondId)));
  }
}
