import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { OrgsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { userNotEligibleError } from "./users-error";

/**
 * 判定「角色授予資格」時讀組織用的上下文,**刻意不套任何範圍**(可見範圍與管理範圍都放到全部):
 * ADR-0005 明定「可見性開關不影響被授予角色的資格 — 資格恆以擁有組織子樹判定(ADR-0003)」,
 * 若拿操作者的可見範圍去算,看不到的所屬組織會被誤判成「失去支撐」而誤解角色。
 * 讀出來的只有 `_id` / `ancestors`(樹的形狀),不外流組織名稱等內容 —
 * 對外顯示的名稱一律另以操作者上下文查(見 UsersService 的 `visibleOrgsOf`)。
 */
function ancestryReader(operator: OperatorContext): OperatorContext {
  return {
    actorId: operator.actorId,
    currentOrgId: operator.currentOrgId,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: operator.memberOrgIds,
    roleIds: operator.roleIds,
  };
}

/** 一棵組織樹的形狀快照:組織 id → 它的祖先 id(物化路徑,ADR-0005)。 */
export type OrgAncestry = ReadonlyMap<string, string[]>;

/** 被檢查資格的一位使用者;`id` 為 null = 還沒落庫的新使用者(只影響錯誤訊息)。 */
export interface EligibilityMember {
  id: Types.ObjectId | null;
  memberOrgIds: readonly Types.ObjectId[];
}

/** 被檢查資格的一個角色;`ownerOrgId` 為 null(資料損毀)時一律無資格。 */
export interface EligibilityRole {
  id: Types.ObjectId;
  ownerOrgId: Types.ObjectId | null;
}

/**
 * 「被授予角色的資格」(ADR-0003):使用者的所屬組織中,至少一個落在該角色擁有組織的子樹內。
 * 三個地方用同一份判斷 — 清單的「組織外」標記、移除所屬組織的 dry-run、授予角色當下的檢查。
 */
@Injectable()
export class OrgQualificationService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
  ) {}

  /**
   * 這些使用者各自的所屬組織(`org_user`)—— `assertEligible` 的原料。
   * 建立使用者時關聯還沒寫入,那條路徑由呼叫端直接把 `memberOrgIds` 交過來。
   */
  async loadMembers(
    userIds: readonly Types.ObjectId[],
  ): Promise<EligibilityMember[]> {
    if (userIds.length === 0) {
      return [];
    }
    const links = await this.relations.listLinks("org_user", {
      secondIds: [...userIds],
    });
    const byUser = new Map<string, Types.ObjectId[]>();
    for (const link of links) {
      const key = String(link.secondId);
      byUser.set(key, [...(byUser.get(key) ?? []), link.firstId]);
    }
    return userIds.map((id) => ({
      id,
      memberOrgIds: byUser.get(String(id)) ?? [],
    }));
  }

  /**
   * **授予資格的唯一檢查點**:每一組(使用者 × 角色)都要有資格,否則
   * `USER_NOT_ELIGIBLE` 並附 `roleId` / `ownerOrgName`。
   *
   * 兩個入口共用它 —— 使用者頁的 `assignUserRoles`(一個人、多個角色)與角色頁的
   * `grantRoleUsers`(一個角色、多個人)。在此之前兩邊各寫一份:同一件事從角色頁
   * 回 `USER_NOT_ELIGIBLE`、從使用者頁回 `VALIDATION_FAILED`,前端只講得出
   * 「資料未通過驗證」。
   *
   * 沒有擁有組織的角色一律無資格(`qualifies` 的定義):管轄邊界不明就不給授予。
   */
  async assertEligible(
    operator: OperatorContext,
    members: readonly EligibilityMember[],
    roles: readonly EligibilityRole[],
  ): Promise<void> {
    if (members.length === 0 || roles.length === 0) {
      return;
    }
    const ancestry = await this.loadAncestry(operator, [
      ...members.flatMap((member) => [...member.memberOrgIds]),
      ...roles.flatMap((role) =>
        role.ownerOrgId === null ? [] : [role.ownerOrgId],
      ),
    ]);

    for (const role of roles) {
      const ownerOrgId =
        role.ownerOrgId === null ? null : String(role.ownerOrgId);
      const blocked = members.find(
        (member) =>
          !this.qualifies(
            member.memberOrgIds.map(String),
            ownerOrgId,
            ancestry,
          ),
      );
      if (blocked) {
        throw userNotEligibleError(
          `User ${String(blocked.id ?? "(new)")} has no member org inside the owner org subtree of role ${String(role.id)}`,
          {
            roleId: String(role.id),
            ownerOrgName: await this.ownerOrgNameOf(operator, role.ownerOrgId),
          },
        );
      }
    }
  }

  /**
   * 擁有組織的名稱,**經操作者上下文查**(治理類 collection,管理範圍自動生效):
   * 範圍外的組織連名稱都不露,錯誤訊息退成「此使用者不在角色擁有組織之下」。
   */
  private async ownerOrgNameOf(
    operator: OperatorContext,
    ownerOrgId: Types.ObjectId | null,
  ): Promise<string | null> {
    if (ownerOrgId === null) {
      return null;
    }
    const org = await this.orgs.findById(operator, ownerOrgId);
    return org?.name ?? null;
  }

  /** 載入這些組織的祖先路徑(判定子樹歸屬的原料)。 */
  async loadAncestry(
    operator: OperatorContext,
    orgIds: Types.ObjectId[],
  ): Promise<OrgAncestry> {
    if (orgIds.length === 0) {
      return new Map();
    }
    const documents = await this.orgs.findMany(ancestryReader(operator), {
      _id: { $in: orgIds },
    });
    return new Map(
      documents.map((org) => [String(org._id), org.ancestors.map(String)]),
    );
  }

  /** 組織是否落在 `rootId` 的子樹內(含自己);樹形狀取自 `loadAncestry`。 */
  isInSubtree(orgId: string, rootId: string, ancestry: OrgAncestry): boolean {
    return orgId === rootId || (ancestry.get(orgId)?.includes(rootId) ?? false);
  }

  /** 有資格 = 所屬組織任一落在擁有組織的子樹內;沒有擁有組織的角色一律視為無資格。 */
  qualifies(
    memberOrgIds: readonly string[],
    ownerOrgId: string | null,
    ancestry: OrgAncestry,
  ): boolean {
    if (ownerOrgId === null) {
      return false;
    }
    return memberOrgIds.some((orgId) =>
      this.isInSubtree(orgId, ownerOrgId, ancestry),
    );
  }
}
