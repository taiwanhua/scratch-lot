import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type Audience,
  type AudienceDynamicRef,
  type AudienceLeaf,
  type AudienceNode,
  type AudienceOrgRange,
  isAudienceGroup,
} from "@repo/domain/audience";
import { ownerModuleKey, wildcardKeyOf } from "@repo/domain/permission";

import {
  OrgsRepository,
  PermissionsRepository,
  RolesRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import {
  type PermissionHolding,
  PermissionResolver,
} from "../permission/permission-resolver";

/**
 * 解析人員條件的使用處提供的上下文。
 *
 * `resolveRef`:動態組織來源(`submission-org`、`tenant`、`form-field:<key>`、`event-org`)
 * 在解析當下代入成組織 id。沒給、或代入結果是空的 → 那個條件列**沒有人符合**(fail-closed:
 * 算不出對象就不放寬)。
 */
export interface AudienceContext {
  resolveRef?: (
    ref: AudienceDynamicRef,
  ) => Promise<readonly Types.ObjectId[]> | readonly Types.ObjectId[];
}

/**
 * 讀治理資料(組織 / 使用者 / 角色 / 權限)用的上下文:兩個範圍放開為 `"all"`。
 * 「本租戶」的邊界由 `listAudience` 自己以租戶子樹收斂,不靠操作者範圍。
 */
const DIRECTORY_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
};

/** 一次請求內、同一位操作者的事實(用到才查,查過就留著)。 */
interface OperatorFacts {
  permissionKeys?: Promise<PermissionHolding>;
  /** 所屬組織各自的祖先(含自己):判斷「含下層」用。 */
  memberOrgLineage?: Promise<Set<string>>;
  /** 「含上層」:指定組織(排序後的 id 串)→ 它們本身與所有上層。 */
  ancestorsByTargets?: Map<string, Promise<Set<string>>>;
}

function intersect(sets: Set<string>[]): Set<string> {
  const [first, ...rest] = sets;
  if (!first) {
    return new Set();
  }
  return new Set([...first].filter((id) => rest.every((set) => set.has(id))));
}

function union(sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

/**
 * 人員條件的兩種用法,一份定義(《底座規格》3.0「兩種用法,一份定義」):
 *
 * | 用法             | 方法              | 怎麼算                                                                |
 * | ---------------- | ----------------- | --------------------------------------------------------------------- |
 * | 判斷這個人符合嗎 | `matchesAudience` | 用這次請求已算好的啟用中角色、所屬組織、有效權限,逐層 AND / OR       |
 * | 列出符合的人     | `listAudience`    | 每個條件列各查一群人,AND 交集、OR 聯集;權限從 `role_permission` 反推 |
 *
 * 共同規則:停用的權限、模組(含祖先停用)、角色都不算;**權限條件只算實際授予的權限,
 * 不套超級管理員的略過**(`PermissionResolver.grantedPermissionKeys`)。權限條件看的是展開後的
 * **有效權限 key 是否在集合裡**(已剔除停用 / 不存在 / 別租戶表單的),**不走 `holdsPermission` 的
 * `*` 同層回退** —— 持 `X.*` 不代表持有 `X` 底下已停用的 key(`@RequirePermission` 守門仍用 `holdsPermission`)。
 *
 * 別租戶表單動態權限的「租戶」:判斷用操作者的當前組織、列出用這次列名單的租戶。同時屬於多個租戶的人,
 * 當前組織不在列名單的租戶時兩條路可能不同 —— 已知並接受(一般使用者只屬一個租戶)。
 * `listAudience` 只列啟用中、在本租戶(所屬組織至少一個在租戶子樹內)的使用者。
 *
 * 兩條路對同一組條件與使用者的結果必須一致(`audience.test.ts` 的表格測試)。
 *
 * **租戶邊界不在這裡檢查條件本身**:`listAudience` 只以「使用者在本租戶子樹內」收斂名單,
 * 不檢查條件裡的角色 / 指定組織 / 指定使用者是不是本租戶的。租戶端的使用處(審核者、知會、
 * 逾時通知、通知收件人)**要在儲存時**自己檢查角色與組織屬於本租戶(格式檢查只看形狀,
 * `validateAudience` 不知道租戶);資料範圍由 root 設定、本來就跨租戶,不在此限。
 */
@Injectable()
export class AudienceService {
  private readonly factsCache = new WeakMap<OperatorContext, OperatorFacts>();

  constructor(
    private readonly orgs: OrgsRepository,
    private readonly users: UsersRepository,
    private readonly roles: RolesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly relations: RelationService,
    private readonly resolver: PermissionResolver,
  ) {}

  // ---- 判斷這個人符合嗎 ----

  async matchesAudience(
    operator: OperatorContext,
    audience: Audience,
    ctx: AudienceContext = {},
  ): Promise<boolean> {
    if (audience.mode === "all") {
      return true;
    }
    return this.matchesNode(operator, audience.filter, ctx);
  }

  private async matchesNode(
    operator: OperatorContext,
    node: AudienceNode,
    ctx: AudienceContext,
  ): Promise<boolean> {
    if (!isAudienceGroup(node)) {
      return this.matchesLeaf(operator, node, ctx);
    }
    // 依序求值、可短路:AND 遇到不符就停,OR 遇到符合就停
    for (const child of node.children) {
      const matched = await this.matchesNode(operator, child, ctx);
      if (node.op === "AND" && !matched) {
        return false;
      }
      if (node.op === "OR" && matched) {
        return true;
      }
    }
    return node.op === "AND";
  }

  private async matchesLeaf(
    operator: OperatorContext,
    leaf: AudienceLeaf,
    ctx: AudienceContext,
  ): Promise<boolean> {
    switch (leaf.field) {
      case "user": {
        const ids = new Set(staticValuesOf(leaf));
        return operator.actorId !== null && ids.has(String(operator.actorId));
      }
      case "role": {
        const ids = new Set(staticValuesOf(leaf));
        return operator.roleIds.some((id) => ids.has(String(id)));
      }
      case "permission": {
        const holding = await this.permissionKeysOf(operator);
        return staticValuesOf(leaf).some((key) =>
          holding.permissionKeys.has(key),
        );
      }
      case "org": {
        return this.matchesOrg(operator, leaf, ctx);
      }
      default: {
        return false;
      }
    }
  }

  private async matchesOrg(
    operator: OperatorContext,
    leaf: AudienceLeaf,
    ctx: AudienceContext,
  ): Promise<boolean> {
    const targets = await this.orgTargetsOf(leaf, ctx);
    if (targets.length === 0 || operator.memberOrgIds.length === 0) {
      return false;
    }
    const range: AudienceOrgRange = leaf.range ?? "self";
    if (range === "descendants") {
      // 所屬組織本身或它的任一上層是指定組織
      const lineage = await this.memberOrgLineageOf(operator);
      return targets.some((id) => lineage.has(String(id)));
    }
    const orgIds =
      range === "self"
        ? new Set(targets.map(String))
        : await this.cachedSelfAndAncestorIds(operator, targets);
    return operator.memberOrgIds.some((id) => orgIds.has(String(id)));
  }

  /**
   * 「含上層」的組織集合,同一個請求內依指定組織快取(資料範圍一次請求可能查好幾張表,
   * 每張都要判斷同一條規則)。只活在這個請求:組織搬家後下一個請求就讀到新的樹。
   */
  private cachedSelfAndAncestorIds(
    operator: OperatorContext,
    targets: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    const facts = this.factsOf(operator);
    facts.ancestorsByTargets ??= new Map();
    const key = targets
      .map(String)
      .toSorted((a, b) => a.localeCompare(b))
      .join(",");
    let cached = facts.ancestorsByTargets.get(key);
    if (!cached) {
      cached = this.selfAndAncestorIds(targets);
      facts.ancestorsByTargets.set(key, cached);
    }
    return cached;
  }

  private factsOf(operator: OperatorContext): OperatorFacts {
    const cached = this.factsCache.get(operator);
    if (cached) {
      return cached;
    }
    const facts: OperatorFacts = {};
    this.factsCache.set(operator, facts);
    return facts;
  }

  /**
   * 操作者實際被授予的有效權限(同一個請求只算一次;看 `permissionKeys` 的成員,不走 `*` 回退)。別租戶表單的動態權限以他的**當前組織**
   * 判斷,與 `PermissionResolver.resolve` 同義。
   */
  private permissionKeysOf(
    operator: OperatorContext,
  ): Promise<PermissionHolding> {
    const facts = this.factsOf(operator);
    facts.permissionKeys ??= this.resolver.grantedPermissionKeys(
      operator.roleIds,
      operator.currentOrgId,
    );
    return facts.permissionKeys;
  }

  private memberOrgLineageOf(operator: OperatorContext): Promise<Set<string>> {
    const facts = this.factsOf(operator);
    facts.memberOrgLineage ??= this.orgs
      .findMany(DIRECTORY_READER, { _id: { $in: operator.memberOrgIds } })
      .then(
        (orgs) =>
          new Set(
            orgs.flatMap((org) => [
              String(org._id),
              ...org.ancestors.map(String),
            ]),
          ),
      );
    return facts.memberOrgLineage;
  }

  // ---- 列出符合的人 ----

  /**
   * 列出租戶內符合的使用者 id。每個條件列各自查出一群人,AND 取交集、OR 取聯集,
   * 最後只留啟用中、所屬組織在本租戶子樹內的人。
   */
  async listAudience(
    tenantId: Types.ObjectId,
    audience: Audience,
    ctx: AudienceContext = {},
  ): Promise<Types.ObjectId[]> {
    const eligible = await this.eligibleUserIds(tenantId);
    const matched =
      audience.mode === "all"
        ? eligible
        : await this.listNode(audience.filter, ctx, tenantId);
    return [...eligible]
      .filter((id) => matched.has(id))
      .map((id) => new Types.ObjectId(id));
  }

  private async listNode(
    node: AudienceNode,
    ctx: AudienceContext,
    tenantId: Types.ObjectId,
  ): Promise<Set<string>> {
    if (!isAudienceGroup(node)) {
      return this.listLeaf(node, ctx, tenantId);
    }
    const sets = await Promise.all(
      node.children.map((child) => this.listNode(child, ctx, tenantId)),
    );
    return node.op === "AND" ? intersect(sets) : union(sets);
  }

  private async listLeaf(
    leaf: AudienceLeaf,
    ctx: AudienceContext,
    tenantId: Types.ObjectId,
  ): Promise<Set<string>> {
    switch (leaf.field) {
      case "user": {
        return new Set(staticValuesOf(leaf));
      }
      case "role": {
        return this.holdersOfRoles(objectIdsOf(staticValuesOf(leaf)));
      }
      case "permission": {
        return this.holdersOfPermissions(staticValuesOf(leaf), tenantId);
      }
      case "org": {
        return this.membersOfOrgCondition(leaf, ctx);
      }
      default: {
        return new Set();
      }
    }
  }

  /** 啟用中角色的持有者(`user_role`)。 */
  private async holdersOfRoles(
    roleIds: Types.ObjectId[],
  ): Promise<Set<string>> {
    if (roleIds.length === 0) {
      return new Set();
    }
    const enabled = await this.roles.findMany(DIRECTORY_READER, {
      _id: { $in: roleIds },
      enabled: true,
    });
    const links = await this.relations.listLinks("user_role", {
      secondIds: enabled.map((role) => role._id),
    });
    return new Set(links.map((link) => String(link.firstId)));
  }

  /**
   * 持有任一權限 key 的人:先從 `role_permission` 反推候選角色(直接授予該權限,或授予同模組的
   * `<模組>.*` —— 展開會得到它),找出持有這些角色的人;再以每個候選人的啟用中角色走一次
   * `grantedPermissionKeys` 看 key 在不在展開後的集合裡(與 `matchesAudience` 同一份判斷:
   * 停用的權限 / 模組 / 角色、模組要有綁定、別租戶表單的動態權限都在那裡處理),確認真的持有。
   * 候選名單只會多不會少,第二步保證與逐人判斷一致。
   */
  private async holdersOfPermissions(
    keys: string[],
    tenantId: Types.ObjectId,
  ): Promise<Set<string>> {
    const candidateKeys = [
      ...new Set(
        keys.flatMap((key) => [key, wildcardKeyOf(ownerModuleKey(key))]),
      ),
    ];
    const granting = await this.permissions.findMany(DIRECTORY_READER, {
      key: { $in: candidateKeys },
    });
    if (granting.length === 0) {
      return new Set();
    }
    const grantingRoleIds = await this.relations.listLinks("role_permission", {
      secondIds: granting.map((permission) => permission._id),
    });
    const candidates = await this.holdersOfRoles(
      grantingRoleIds.map((link) => link.firstId),
    );
    return this.confirmHolders(candidates, keys, tenantId);
  }

  /**
   * 候選人逐一確認:同一組啟用中角色只算一次有效權限。別租戶表單的動態權限以**這次列名單的租戶**
   * 判斷(名單只列本租戶的人,他們在本租戶裡的當前組織同屬這個租戶)。
   */
  private async confirmHolders(
    candidates: Set<string>,
    keys: string[],
    tenantId: Types.ObjectId,
  ): Promise<Set<string>> {
    if (candidates.size === 0) {
      return new Set();
    }
    const userRoles = await this.relations.listLinks("user_role", {
      firstIds: objectIdsOf([...candidates]),
    });
    const enabledRoles = await this.roles.findMany(DIRECTORY_READER, {
      _id: { $in: userRoles.map((link) => link.secondId) },
      enabled: true,
    });
    const enabledIds = new Set(enabledRoles.map((role) => String(role._id)));
    const rolesByUser = new Map<string, string[]>();
    for (const link of userRoles) {
      const roleId = String(link.secondId);
      if (!enabledIds.has(roleId)) {
        continue;
      }
      const userId = String(link.firstId);
      rolesByUser.set(userId, [...(rolesByUser.get(userId) ?? []), roleId]);
    }
    const holdingBySet = new Map<string, Promise<PermissionHolding>>();
    const holders = new Set<string>();
    for (const [userId, roleIds] of rolesByUser) {
      const setKey = roleIds.toSorted((x, y) => x.localeCompare(y)).join(",");
      let holding = holdingBySet.get(setKey);
      if (!holding) {
        holding = this.resolver.grantedPermissionKeys(
          objectIdsOf(roleIds),
          tenantId,
        );
        holdingBySet.set(setKey, holding);
      }
      const resolved = await holding;
      if (keys.some((key) => resolved.permissionKeys.has(key))) {
        holders.add(userId);
      }
    }
    return holders;
  }

  /** 所屬組織條件 → 該範圍內組織的成員(`org_user`)。 */
  private async membersOfOrgCondition(
    leaf: AudienceLeaf,
    ctx: AudienceContext,
  ): Promise<Set<string>> {
    const targets = await this.orgTargetsOf(leaf, ctx);
    if (targets.length === 0) {
      return new Set();
    }
    const range: AudienceOrgRange = leaf.range ?? "self";
    const orgIds = await this.orgIdsInRange(targets, range);
    const links = await this.relations.listLinks("org_user", {
      firstIds: objectIdsOf([...orgIds]),
    });
    return new Set(links.map((link) => String(link.secondId)));
  }

  /** 範圍內(存在的)組織 id:本身 / 含下層 / 含上層。 */
  private async orgIdsInRange(
    targets: Types.ObjectId[],
    range: AudienceOrgRange,
  ): Promise<Set<string>> {
    if (range === "ancestors") {
      const ids = await this.selfAndAncestorIds(targets);
      const existing = await this.orgs.findMany(DIRECTORY_READER, {
        _id: { $in: objectIdsOf([...ids]) },
      });
      return new Set(existing.map((org) => String(org._id)));
    }
    const orgs = await this.orgs.findMany(
      DIRECTORY_READER,
      range === "self"
        ? { _id: { $in: targets } }
        : { $or: [{ _id: { $in: targets } }, { ancestors: { $in: targets } }] },
    );
    return new Set(orgs.map((org) => String(org._id)));
  }

  /** 指定組織(存在的)本身與它們的所有上層。 */
  private async selfAndAncestorIds(
    targets: readonly Types.ObjectId[],
  ): Promise<Set<string>> {
    const orgs = await this.orgs.findMany(DIRECTORY_READER, {
      _id: { $in: [...targets] },
    });
    return new Set(
      orgs.flatMap((org) => [String(org._id), ...org.ancestors.map(String)]),
    );
  }

  /** 組織條件的對象:靜態 = 指定的 id;動態 = 使用處代入(沒給解析 → 空)。 */
  private async orgTargetsOf(
    leaf: AudienceLeaf,
    ctx: AudienceContext,
  ): Promise<Types.ObjectId[]> {
    if (leaf.value.kind === "static") {
      return objectIdsOf(leaf.value.values);
    }
    if (!ctx.resolveRef) {
      return [];
    }
    return [...(await ctx.resolveRef(leaf.value.ref))];
  }

  /** 本租戶內啟用中的使用者:所屬組織至少一個在租戶子樹(租戶頂層 + 所有下層)內。 */
  private async eligibleUserIds(
    tenantId: Types.ObjectId,
  ): Promise<Set<string>> {
    const tenantOrgs = await this.orgs.findMany(DIRECTORY_READER, {
      $or: [{ _id: tenantId }, { ancestors: tenantId }],
    });
    const links = await this.relations.listLinks("org_user", {
      firstIds: tenantOrgs.map((org) => org._id),
    });
    const members = [...new Set(links.map((link) => String(link.secondId)))];
    if (members.length === 0) {
      return new Set();
    }
    const enabled = await this.users.findMany(DIRECTORY_READER, {
      _id: { $in: objectIdsOf(members) },
      enabled: true,
    });
    return new Set(enabled.map((user) => String(user._id)));
  }
}

function staticValuesOf(leaf: AudienceLeaf): string[] {
  return leaf.value.kind === "static" ? leaf.value.values : [];
}

/** 字串 id → ObjectId(不合法的略過;schema 已擋,這裡只是防守)。 */
function objectIdsOf(ids: readonly string[]): Types.ObjectId[] {
  return ids
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
}
