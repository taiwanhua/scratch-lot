import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { OrgsRepository, RolesRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { tenantTopIdOf } from "../orgs/org-mapper";
import { OwnerProtectionService } from "../orgs/owner-protection.service";
import type { RoleModel, RoleOrgRef } from "./models/role.model";
import {
  type RoleOperatorFacts,
  type RoleRecord,
  isTemplateCopy,
  roleAbilitiesOf,
  roleKindOf,
} from "./role-rules";
import { notFoundError, validationError } from "./roles-error";

export type { RoleRecord } from "./role-rules";

/** id 字串轉 ObjectId;不合法即 `VALIDATION_FAILED` 並指出是哪一欄(不讓 Mongo 的 CastError 外漏)。 */
export function toObjectId(value: string, field: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw validationError(`${field} is not a valid id: ${value}`, [field]);
  }
  return new Types.ObjectId(value);
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function uniqueObjectIds(ids: Types.ObjectId[]): Types.ObjectId[] {
  return [...new Map(ids.map((id) => [String(id), id])).values()];
}

/**
 * 角色的**管轄邊界判定**與清單投影(ADR-0003「擁有組織 = 角色的管轄邊界」、
 * CONTEXT.md「管理範圍」):三支角色服務(CRUD / 矩陣 / 分配使用者)共用同一個判斷點,
 * 不各寫一套。
 *
 * 範圍的落實點只有一個:凡查組織都經 `this.orgs`(治理類 collection,過濾自動吃
 * `managedOrgIds`),再由組織反查 `org_role` — 本檔不自己比對任何組織集合。
 * `roles` 自己沒掛租戶過濾(歸屬走 `org_role` 關聯,ADR-0005),所以範圍必須在這裡補上。
 */
@Injectable()
export class RoleScopeService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
    private readonly ownerProtection: OwnerProtectionService,
  ) {}

  /**
   * 角色種類規則要用的「操作者事實」:誰站在根組織、他自己持有哪些角色。
   * 一次請求取一次,`decorate` 與四支寫入端點共用同一組事實。
   *
   * 持有的角色以 `user_role` 直接查,不用 `operator.roleIds` —— 後者只含**啟用中**的角色
   * (登入線的定義),而自鎖保護要判的是「這筆授予在不在」,與角色目前開著或關著無關。
   */
  async operatorFactsOf(
    operator: OperatorContext,
  ): Promise<
    Omit<RoleOperatorFacts, "hasGrants"> & { heldRoleIds: Set<string> }
  > {
    const [isRootOperator, heldRoleIds] = await Promise.all([
      this.ownerProtection.isRootOperator(operator),
      operator.actorId === null
        ? Promise.resolve([])
        : this.relations.listRoleIdsOfUser(operator.actorId),
    ]);
    return {
      isRootOperator,
      isHeldByOperator: false,
      heldRoleIds: new Set(heldRoleIds.map(String)),
    };
  }

  /** 單一角色的事實(`decorate` 以外的呼叫端:四支寫入端點各擋一次)。 */
  async factsOf(
    operator: OperatorContext,
    role: RoleRecord,
  ): Promise<RoleOperatorFacts> {
    const { isRootOperator, heldRoleIds } =
      await this.operatorFactsOf(operator);
    const grantedUserIds = await this.relations.listUserIdsOfRole(role._id);
    return {
      isRootOperator,
      isHeldByOperator: heldRoleIds.has(String(role._id)),
      hasGrants: grantedUserIds.length > 0,
    };
  }

  /**
   * 清單的角色過濾條件:擁有組織在操作者**管理範圍**內的角色。
   * 管理範圍是全部(超級管理員 / 擁有組織是根組織)→ 不必先攤開組織樹再反查。
   * 管理範圍內沒有任何組織擁有角色 → 回 null = 空清單。
   *
   * `ownerOrgId`在管理範圍**之內**再收窄:只留擁有組織正好是它的角色
   * (不含子樹,見 `RolesInput.ownerOrgId`)。組織一律經 `this.orgs` 取,
   * 所以管理範圍外的 id 查不到 → 回 null = 空清單,不必另外比對範圍。
   */
  async managedRoleFilter(
    operator: OperatorContext,
    ownerOrgId?: string,
  ): Promise<Record<string, unknown> | null> {
    if (ownerOrgId !== undefined) {
      const org = await this.orgs.findById(
        operator,
        toObjectId(ownerOrgId, "ownerOrgId"),
      );
      if (org === null) {
        return null;
      }
      return this.rolesOwnedBy([org._id]);
    }
    if (operator.managedOrgIds === "all") {
      return {};
    }
    const managedOrgs = await this.orgs.findMany(operator, {});
    if (managedOrgs.length === 0) {
      return null;
    }
    return this.rolesOwnedBy(managedOrgs.map((org) => org._id));
  }

  /** 這些組織擁有的角色的過濾條件(`org_role`);一個都沒有 → null = 空清單。 */
  private async rolesOwnedBy(
    orgIds: Types.ObjectId[],
  ): Promise<Record<string, unknown> | null> {
    const links = await this.relations.listLinks("org_role", {
      firstIds: orgIds,
    });
    if (links.length === 0) {
      return null;
    }
    return { _id: { $in: links.map((link) => link.secondId) } };
  }

  /**
   * 取一筆在操作者管理範圍內的角色;範圍外或不存在一律 `NOT_FOUND`(不透露差別)。
   * 沒有擁有組織的角色(資料損毀)視同範圍外 — 管轄邊界不明的角色不給操作。
   */
  async loadManagedRole(
    operator: OperatorContext,
    id: string,
  ): Promise<RoleRecord> {
    const role = await this.roles.findById(operator, toObjectId(id, "id"));
    if (!role) {
      throw notFoundError(`Role ${id} not found`);
    }
    const ownerOrgId = await this.relations.findOwnerOrgIdOfRole(role._id);
    if (ownerOrgId === null) {
      throw notFoundError(`Role ${id} not found`);
    }
    if (operator.managedOrgIds === "all") {
      return role;
    }
    const managed = await this.orgs.findById(operator, ownerOrgId);
    if (!managed) {
      throw notFoundError(`Role ${id} not found`);
    }
    return role;
  }

  /** 角色的擁有組織 id(`org_role`);沒有即資料損毀,呼叫端已先經 `loadManagedRole` 排除。 */
  ownerOrgIdOf(role: RoleRecord): Promise<Types.ObjectId | null> {
    return this.relations.findOwnerOrgIdOfRole(role._id);
  }

  /** 組織必須在操作者**管理範圍**內(ADR-0005 的分工表);不在即 `FORBIDDEN` 由呼叫端丟。 */
  async findManagedOrg(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<{ _id: Types.ObjectId; name: string } | null> {
    const org = await this.orgs.findById(operator, orgId);
    return org === null ? null : { _id: org._id, name: org.name };
  }

  /**
   * 把角色文件組成 GraphQL 形狀:擁有組織(名稱只給管理範圍內的)與它的租戶頂層、
   * 種類與四個動作(依操作者算好)、授予人數。
   */
  async decorate(
    operator: OperatorContext,
    documents: RoleRecord[],
  ): Promise<RoleModel[]> {
    if (documents.length === 0) {
      return [];
    }
    const roleIds = documents.map((role) => role._id);
    const [ownerLinks, grantLinks, facts] = await Promise.all([
      this.relations.listLinks("org_role", { secondIds: roleIds }),
      this.relations.listLinks("user_role", { secondIds: roleIds }),
      this.operatorFactsOf(operator),
    ]);
    const ownerOrgIdByRole = new Map(
      ownerLinks.map((link) => [String(link.secondId), String(link.firstId)]),
    );
    const userCountByRole = new Map<string, number>();
    for (const link of grantLinks) {
      const key = String(link.secondId);
      userCountByRole.set(key, (userCountByRole.get(key) ?? 0) + 1);
    }
    const ownerOrgById = await this.ownerOrgRefs(
      operator,
      uniqueObjectIds(ownerLinks.map((link) => link.firstId)),
    );

    return documents.map((role) => {
      const key = String(role._id);
      const ownerOrgId = ownerOrgIdByRole.get(key) ?? null;
      const userCount = userCountByRole.get(key) ?? 0;
      const roleFacts: RoleOperatorFacts = {
        isRootOperator: facts.isRootOperator,
        isHeldByOperator: facts.heldRoleIds.has(key),
        hasGrants: userCount > 0,
      };
      return {
        id: key,
        name: role.name,
        description: role.description ?? null,
        enabled: role.enabled,
        kind: roleKindOf(role),
        abilities: roleAbilitiesOf(role, roleFacts),
        isSystem: role.isSystem,
        isTemplateCopy: isTemplateCopy(role),
        ownerOrg:
          ownerOrgId === null ? null : (ownerOrgById.get(ownerOrgId) ?? null),
        userCount,
      };
    });
  }

  /**
   * 擁有組織 id → `{ id, name, tenantTop }`;**只給管理範圍內**的組織(範圍外連名稱都不露)。
   * 租戶頂層由物化路徑推(`tenantTopIdOf`,`org-mapper.ts`),名稱同樣經操作者上下文查 —
   * 查不到(範圍外、或擁有組織就是根組織)時 `tenantTop` 為 null。
   */
  private async ownerOrgRefs(
    operator: OperatorContext,
    ownerOrgIds: Types.ObjectId[],
  ): Promise<
    Map<string, { id: string; name: string; tenantTop: RoleOrgRef | null }>
  > {
    if (ownerOrgIds.length === 0) {
      return new Map();
    }
    const managedOrgs = await this.orgs.findMany(operator, {
      _id: { $in: ownerOrgIds },
    });
    const tenantTopIdByOrg = new Map(
      managedOrgs.map((org) => [String(org._id), tenantTopIdOf(org)]),
    );
    const knownNames = new Map(
      managedOrgs.map((org) => [String(org._id), org.name]),
    );
    const missingTopIds = uniqueObjectIds(
      [...tenantTopIdByOrg.values()].filter(
        (id) => !knownNames.has(String(id)),
      ),
    );
    const tops =
      missingTopIds.length === 0
        ? []
        : await this.orgs.findMany(operator, { _id: { $in: missingTopIds } });
    for (const top of tops) {
      knownNames.set(String(top._id), top.name);
    }

    return new Map(
      managedOrgs.map((org) => {
        const id = String(org._id);
        // 擁有組織是根組織時 `tenantTopIdOf` 回自己 — 那不是租戶,不給分組用
        const topId = String(tenantTopIdByOrg.get(id) ?? org._id);
        const topName =
          org.ancestors.length === 0 ? undefined : knownNames.get(topId);
        return [
          id,
          {
            id,
            name: org.name,
            tenantTop:
              topName === undefined ? null : { id: topId, name: topName },
          },
        ];
      }),
    );
  }

  /** 單筆的 `decorate`(寫入動作的回傳都是一份文件)。 */
  async decorateOne(
    operator: OperatorContext,
    document: RoleRecord,
  ): Promise<RoleModel> {
    const [model] = await this.decorate(operator, [document]);
    if (!model) {
      throw notFoundError(`Role ${String(document._id)} not found`);
    }
    return model;
  }
}
