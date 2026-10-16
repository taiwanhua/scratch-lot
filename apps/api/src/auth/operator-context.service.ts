import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import {
  type OrgDocument,
  OrgsRepository,
  type RoleDocument,
  RolesRepository,
} from "../database/database.module";
import type {
  OperatorContext,
  OperatorOrgScope,
} from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { SUPER_ADMIN_ROLE_KEY } from "../permission/permission-resolver";

/** 租戶頂層 `orgs.settings.visibility` 的值(ADR-0005;未設視為 "own")。 */
const VISIBILITY_SUBTREE = "subtree";

/**
 * 登入線自己讀組織樹時用的上下文:計算兩個範圍的當下還沒有範圍可用,
 * 這是唯一合法以 "all" 讀 orgs 的地方(此服務即兩個範圍的計算明文;資料層只消費結果)。
 */
function systemOperator(actorId: Types.ObjectId | null): OperatorContext {
  return {
    actorId,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    // 這份上下文就是在「算出 memberOrgIds / roleIds」的過程中用的,當下還沒有值(#246 的 6)
    memberOrgIds: [],
    roleIds: [],
  };
}

type RoleRecord = Persisted<RoleDocument>;

export interface MemberOrg {
  id: Types.ObjectId;
  name: string;
  parentId: Types.ObjectId | null;
  /**
   * 商標的 GCS 物件路徑(ADR-0010:存路徑不存 URL);`me` 據此現簽讀取網址。
   * 自己沒設商標時是**繼承**來的 — 沿 `ancestors` 由近到遠的第一個有商標的上層
   * (ADR-0010:子組織沒設就顯示租戶的)。
   */
  logoPath?: string;
}

export interface OperatorResolution {
  operator: OperatorContext;
  /** 所屬組織清單,依加入時間(org_user 建立時間)排序。 */
  memberOrgs: MemberOrg[];
}

/**
 * 由 userId 算出操作者上下文(CONTEXT.md:操作者 / 當前組織 / 可見範圍 / 管理範圍)。
 *
 * **兩個範圍各自獨立算**(ADR-0005「管理範圍與可見範圍的分工」):
 * - **可見範圍**(業務資料,ADR-0005):所屬組織 `org_user` 的聯集;根組織成員 → `"all"`;
 *   所屬組織的租戶頂層 `settings.visibility` 為 "subtree" 時各自含其整棵下層
 * - **管理範圍**(治理模組,ADR-0003「擁有組織 = 角色的管轄邊界」):持有的**啟用中角色**
 *   各自的**擁有組織子樹**取聯集;持超級管理員(或任一擁有組織是根組織)→ `"all"`;
 *   沒有任何啟用中的角色 → 空陣列(治理頁一片空白,這是正確結果)
 *
 * 管理範圍**不看**所屬組織、也**不受可見性開關影響** — 要給不同範圍就建不同擁有組織的角色。
 */
@Injectable()
export class OperatorContextService {
  constructor(
    private readonly relations: RelationService,
    private readonly orgs: OrgsRepository,
    private readonly roles: RolesRepository,
  ) {}

  async resolve(
    userId: Types.ObjectId,
    currentOrgId: Types.ObjectId | null,
  ): Promise<OperatorResolution> {
    const reader = systemOperator(userId);
    const memberships = await this.relations.listOrgMembershipsOfUser(userId);
    const memberOrgIds = memberships.map((membership) => membership.orgId);
    const memberDocuments = await this.orgs.findMany(reader, {
      _id: { $in: memberOrgIds },
    });
    const byId = new Map(memberDocuments.map((org) => [String(org._id), org]));
    // 依加入時間排序(RelationService 已排序),只留仍存在的組織
    const memberOrgDocuments = memberOrgIds
      .map((id) => byId.get(String(id)))
      .filter(
        (org): org is (typeof memberDocuments)[number] => org !== undefined,
      );

    const memberOrgs = await this.toMemberOrgs(reader, memberOrgDocuments);
    const resolvedCurrentOrgId =
      currentOrgId && memberOrgs.some((org) => org.id.equals(currentOrgId))
        ? currentOrgId
        : (memberOrgs[0]?.id ?? null);

    const [visibleOrgIds, enabledRoles] = await Promise.all([
      this.visibleOrgIdsOf(reader, memberOrgDocuments),
      this.enabledRolesOf(reader, userId),
    ]);
    const managedOrgIds = await this.managedOrgIdsOf(reader, enabledRoles);
    return {
      operator: {
        actorId: userId,
        currentOrgId: resolvedCurrentOrgId,
        visibleOrgIds,
        managedOrgIds,
        // 資料範圍規則的比對來源(ADR-0008):所屬組織是 org_user 的直接關聯,不含開關展開的下層
        memberOrgIds: memberOrgs.map((org) => org.id),
        roleIds: enabledRoles.map((role) => role._id),
      },
      memberOrgs,
    };
  }

  /**
   * 系統身分(表單 / 流程掛接點的事後動作;底座規格 3.1 B1):沒有操作者、不帶任何角色,
   * 以單據的組織為所屬組織、當前組織;可見範圍照登入線同一條規則算(根組織 → 全部;
   * 租戶頂層開了「含下層」→ 含其整棵下層),不使用按下按鈕那個人的權限。組織不存在 → 只看得到它自己。
   */
  async systemOperatorOfOrg(orgId: Types.ObjectId): Promise<OperatorContext> {
    const reader = systemOperator(null);
    const org = await this.orgs.findById(reader, orgId);
    return {
      actorId: null,
      currentOrgId: orgId,
      visibleOrgIds:
        org === null ? [orgId] : await this.visibleOrgIdsOf(reader, [org]),
      managedOrgIds: [],
      memberOrgIds: [orgId],
      roleIds: [],
    };
  }

  /**
   * 側欄商標(ADR-0010):自己的 `logoPath`,沒有就沿 `ancestors` 由近到遠找第一個有商標的上層。
   * 一次把所有所屬組織的祖先查回來,不逐筆往上爬(所屬組織通常只有幾個,祖先鏈也短)。
   */
  private async toMemberOrgs(
    reader: OperatorContext,
    memberOrgs: OrgDocument[],
  ): Promise<MemberOrg[]> {
    const ancestorIds = memberOrgs.flatMap((org) => org.ancestors);
    const ancestors =
      ancestorIds.length === 0
        ? []
        : await this.orgs.findMany(reader, { _id: { $in: ancestorIds } });
    const logoPathById = new Map(
      ancestors.map((org) => [String(org._id), org.logoPath]),
    );
    return memberOrgs.map((org) => {
      // ancestors 由根到父,由近到遠 = 反向走
      const inherited = org.ancestors
        .toReversed()
        .map((id) => logoPathById.get(String(id)))
        .find((logoPath) => logoPath !== undefined);
      const logoPath = org.logoPath ?? inherited;
      return {
        id: org._id,
        name: org.name,
        parentId: org.parentId,
        ...(logoPath === undefined ? {} : { logoPath }),
      };
    });
  }

  private async visibleOrgIdsOf(
    reader: OperatorContext,
    memberOrgs: OrgDocument[],
  ): Promise<OperatorOrgScope> {
    if (memberOrgs.some((org) => org.parentId === null)) {
      return "all";
    }
    const visible = new Map<string, Types.ObjectId>();
    for (const org of memberOrgs) {
      visible.set(String(org._id), org._id);
      if (await this.isSubtreeVisible(reader, org)) {
        const descendants = await this.orgs.findMany(reader, {
          ancestors: org._id,
        });
        for (const descendant of descendants) {
          visible.set(String(descendant._id), descendant._id);
        }
      }
    }
    return [...visible.values()];
  }

  /**
   * 操作者持有的**啟用中角色**(ADR-0011 步驟 2:停用的角色不算)。
   * 管理範圍與資料範圍的套用對象比對都以這一份為準 — 只查一次、兩邊共用同一條規則。
   */
  private async enabledRolesOf(
    reader: OperatorContext,
    userId: Types.ObjectId,
  ): Promise<RoleRecord[]> {
    const grantedRoleIds = await this.relations.listRoleIdsOfUser(userId);
    if (grantedRoleIds.length === 0) {
      return [];
    }
    return this.roles.findMany(reader, {
      _id: { $in: grantedRoleIds },
      enabled: true,
    });
  }

  /**
   * 管理範圍(ADR-0003 的表格最後一列):啟用中角色 → 擁有組織 → 各自的子樹聯集。
   * 超級管理員在權限解析時全權放行(ADR-0004),範圍上同樣是全部;
   * 擁有組織是根組織的角色(如租戶管理員**模板**)子樹本來就是全部,直接回 `"all"` 不列舉。
   */
  private async managedOrgIdsOf(
    reader: OperatorContext,
    roles: readonly RoleRecord[],
  ): Promise<OperatorOrgScope> {
    if (roles.length === 0) {
      return [];
    }
    if (
      roles.some((role) => role.isSystem && role.key === SUPER_ADMIN_ROLE_KEY)
    ) {
      return "all";
    }
    const ownerLinks = await this.relations.listLinks("org_role", {
      secondIds: roles.map((role) => role._id),
    });
    const ownerOrgIds = ownerLinks.map((link) => link.firstId);
    if (ownerOrgIds.length === 0) {
      return [];
    }
    const ownerOrgs = await this.orgs.findMany(reader, {
      _id: { $in: ownerOrgIds },
    });
    if (ownerOrgs.some((org) => org.parentId === null)) {
      return "all";
    }
    const managed = new Map<string, Types.ObjectId>(
      ownerOrgs.map((org) => [String(org._id), org._id]),
    );
    if (managed.size > 0) {
      const descendants = await this.orgs.findMany(reader, {
        ancestors: { $in: [...managed.values()] },
      });
      for (const descendant of descendants) {
        managed.set(String(descendant._id), descendant._id);
      }
    }
    return [...managed.values()];
  }

  /** 開關只看租戶頂層(ancestors = [根, 租戶頂層, …];所屬組織本身是租戶頂層時 ancestors 只有根)。 */
  private async isSubtreeVisible(
    reader: OperatorContext,
    org: OrgDocument,
  ): Promise<boolean> {
    const tenantTopId = org.ancestors[1] ?? org._id;
    const tenantTop = tenantTopId.equals(org._id)
      ? org
      : await this.orgs.findById(reader, tenantTopId);
    return tenantTop?.settings.visibility === VISIBILITY_SUBTREE;
  }
}
