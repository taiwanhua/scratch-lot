import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { orgChainToTenant, resolveManagersFrom } from "@repo/domain/workflow";

import { AuditService } from "../audit/audit.service";
import type { Persisted } from "../database/base.repository";
import {
  OrgsRepository,
  type UserDocument,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import type { SetOrgManagersInput } from "./dto/set-org-managers.input";
import type { Org } from "./models/org.model";
import type { UserSummary } from "./models/user-summary.model";
import { orgError, orgValidationError } from "./org-error";
import { type OrgRecord, tenantTopIdOf, toOrg } from "./org-mapper";

type UserRecord = Persisted<UserDocument>;

/** 稽核動作名(docs/modules/org-manager.md「審計」;`targetType` = org)。 */
const AUDIT_SET_MANAGERS = "org.set-managers";

/** 主管候選人一次最多回這麼多(彈窗靠關鍵字收斂)。 */
const CANDIDATE_LIMIT = 50;

/**
 * 內部讀取用的上下文:兩個範圍放開為 `"all"`。**只准搭配把查詢釘在某個租戶子樹內的條件**
 * (`_id` / `ancestors` = 已驗過的組織),理由同 `orgs.service.ts` 的 `subtreeContext`:
 * 主管解析在背景推進時沒有操作者,而「本租戶的使用者」以整棵租戶子樹為準,不看誰在操作。
 */
function systemContext(actorId: Types.ObjectId | null): OperatorContext {
  return {
    actorId,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
  };
}

function toSummary(user: UserRecord): UserSummary {
  return {
    id: String(user._id),
    name: user.name,
    account: user.account,
    enabled: user.enabled,
  };
}

function toObjectIds(ids: readonly string[]): Types.ObjectId[] {
  const invalid = ids.filter((id) => !Types.ObjectId.isValid(id));
  if (invalid.length > 0) {
    throw orgValidationError(
      `userIds are not valid ids: ${invalid.join(", ")}`,
      ["userIds"],
    );
  }
  return [...new Set(ids)].map((id) => new Types.ObjectId(id));
}

/** 關鍵字做部分比對,使用者輸入的 regex 特殊字元一律當字面值。 */
function keywordCondition(
  keyword: string | null | undefined,
): Record<string, unknown> {
  const trimmed = keyword?.trim() ?? "";
  if (trimmed === "") {
    return {};
  }
  const escaped = trimmed.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return {
    $or: ["name", "account"].map((field) => ({
      [field]: { $regex: escaped, $options: "i" },
    })),
  };
}

/**
 * 組織主管(`core_relationships` 的 `org_manager`;docs/modules/org-manager.md「主管」):
 * 組織管理頁設定(整組取代、稽核 `org.set-managers`)、`org.managers` 讀取、主管候選人,
 * 以及審核流程的主管解析 `resolveManagers`(背景推進也會呼叫,不依賴操作者)。
 *
 * 主管是**職位**,與成員關係 `org_user` 分開存:一個組織可多位,主管不必是該組織的直接成員,
 * 但必須是**本租戶**的使用者。
 */
@Injectable()
export class OrgManagersService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly relations: RelationService,
    private readonly audit: AuditService,
  ) {}

  /** 組織目前的主管(含停用的,讓管理者看得到、移得掉);依建立順序。 */
  async managersOf(orgId: string): Promise<UserSummary[]> {
    if (!Types.ObjectId.isValid(orgId)) {
      return [];
    }
    const managerIds = await this.managerIdsOf(new Types.ObjectId(orgId));
    if (managerIds.length === 0) {
      return [];
    }
    const documents = await this.users.findMany(systemContext(null), {
      _id: { $in: managerIds },
    });
    const byId = new Map(documents.map((user) => [String(user._id), user]));
    return managerIds.flatMap((id) => {
      const user = byId.get(String(id));
      return user === undefined ? [] : [toSummary(user)];
    });
  }

  /**
   * 整組取代主管;名單沒變就不寫、也不留稽核。主管必須是本租戶的使用者(停用的也可留在名單上,
   * 解析時自然不算);根組織不屬於任何租戶,不能設主管。
   */
  async setManagers(
    operator: OperatorContext,
    input: SetOrgManagersInput,
  ): Promise<Org> {
    const org = await this.requireManaged(operator, input.orgId);
    if (org.ancestors.length === 0) {
      throw orgValidationError("The root org cannot have managers", ["orgId"]);
    }
    const wanted = toObjectIds(input.userIds);
    const tenantId = tenantTopIdOf(org);
    const memberIds = await this.tenantMemberIds(tenantId);
    const members = new Set(memberIds.map(String));
    const outsiders = wanted.filter((id) => !members.has(String(id)));
    if (outsiders.length > 0) {
      throw orgValidationError(
        `Managers must be users of the same tenant: ${outsiders.join(", ")}`,
        ["userIds"],
      );
    }
    const current = await this.managerIdsOf(org._id);
    const currentKeys = new Set(current.map(String));
    const wantedKeys = new Set(wanted.map(String));
    const toAdd = wanted.filter((id) => !currentKeys.has(String(id)));
    const toRemove = current.filter((id) => !wantedKeys.has(String(id)));
    if (toAdd.length === 0 && toRemove.length === 0) {
      return toOrg(org);
    }
    await this.relations.unlinkMany(
      operator,
      toRemove.map((userId) => ({
        type: "org_manager" as const,
        firstId: org._id,
        secondId: userId,
      })),
    );
    await this.relations.linkMany(
      operator,
      toAdd.map((userId) => ({
        type: "org_manager" as const,
        firstId: org._id,
        secondId: userId,
      })),
    );
    await this.audit.record(operator, {
      action: AUDIT_SET_MANAGERS,
      targetType: "org",
      targetId: org._id,
      before: { managerIds: current.map(String) },
      after: { managerIds: wanted.map(String) },
    });
    return toOrg(org);
  }

  /** 主管候選人:該組織所屬租戶裡**啟用中**的使用者(關鍵字比對姓名 / 帳號,最多 50 位)。 */
  async candidates(
    operator: OperatorContext,
    orgId: string,
    keyword?: string | null,
  ): Promise<UserSummary[]> {
    const org = await this.requireManaged(operator, orgId);
    if (org.ancestors.length === 0) {
      return [];
    }
    const memberIds = await this.tenantMemberIds(tenantTopIdOf(org));
    if (memberIds.length === 0) {
      return [];
    }
    const documents = await this.users.findMany(
      systemContext(operator.actorId),
      { _id: { $in: memberIds }, enabled: true, ...keywordCondition(keyword) },
      { sort: { name: 1, _id: 1 }, limit: CANDIDATE_LIMIT },
    );
    return documents.map((user) => toSummary(user));
  }

  /**
   * 主管解析:起點 = **提交的 `orgId`**(不是申請人現在的當前組織)、
   * 往祖先走、上界 = **提交的 `tenantId`**;遇到第一個「剔除申請人後仍有主管」的組織 = 第 1 層,
   * `level = 2` 再往上找下一組。只算啟用中、仍在本租戶的使用者;到頂還是空 → 空陣列(該關阻擋)。
   * 名單以呼叫當下的主管關係為準,寫進派任計畫後由引擎固定,不再重算。
   */
  async resolveManagers(
    applicantId: Types.ObjectId,
    submissionOrgId: Types.ObjectId,
    tenantId: Types.ObjectId,
    level: number,
  ): Promise<Types.ObjectId[]> {
    const context = systemContext(null);
    const org = await this.orgs.findById(context, submissionOrgId);
    if (org === null) {
      return [];
    }
    const chain = orgChainToTenant(
      String(org._id),
      org.ancestors.map(String),
      String(tenantId),
    );
    if (chain.length === 0) {
      return [];
    }
    const links = await this.relations.listLinks("org_manager", {
      firstIds: chain.map((id) => new Types.ObjectId(id)),
    });
    const eligible = await this.eligibleUserIds(
      tenantId,
      links.map((link) => link.secondId),
    );
    const managersByOrg = new Map<string, string[]>();
    for (const link of links) {
      if (!eligible.has(String(link.secondId))) {
        continue;
      }
      const key = String(link.firstId);
      managersByOrg.set(key, [
        ...(managersByOrg.get(key) ?? []),
        String(link.secondId),
      ]);
    }
    return resolveManagersFrom({
      orgChain: chain,
      managersByOrg,
      applicantId: String(applicantId),
      level,
    }).map((id) => new Types.ObjectId(id));
  }

  // ---- 內部 ----

  private async requireManaged(
    operator: OperatorContext,
    id: string,
  ): Promise<OrgRecord> {
    const org = Types.ObjectId.isValid(id)
      ? await this.orgs.findById(operator, id)
      : null;
    if (org === null) {
      throw orgError("NOT_FOUND", `Org ${id} not found`);
    }
    return org;
  }

  private async managerIdsOf(orgId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const links = await this.relations.listLinks("org_manager", {
      firstIds: [orgId],
    });
    return links
      .toSorted(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      )
      .map((link) => link.secondId);
  }

  /** 租戶子樹(租戶頂層 + 所有下層)的組織成員 id(`org_user`,去重)。 */
  private async tenantMemberIds(
    tenantId: Types.ObjectId,
  ): Promise<Types.ObjectId[]> {
    const orgs = await this.orgs.findMany(systemContext(null), {
      $or: [{ _id: tenantId }, { ancestors: tenantId }],
    });
    const links = await this.relations.listLinks("org_user", {
      firstIds: orgs.map((one) => one._id),
    });
    return [
      ...new Map(links.map((link) => [String(link.secondId), link.secondId])),
    ].map(([, id]) => id);
  }

  /** 這些人裡啟用中、且仍在本租戶的(主管解析只算他們)。 */
  private async eligibleUserIds(
    tenantId: Types.ObjectId,
    candidateIds: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) {
      return new Set();
    }
    const memberIds = await this.tenantMemberIds(tenantId);
    const members = new Set(memberIds.map(String));
    const enabled = await this.users.findMany(systemContext(null), {
      _id: { $in: [...candidateIds] },
      enabled: true,
    });
    return new Set(
      enabled.map((user) => String(user._id)).filter((id) => members.has(id)),
    );
  }
}
