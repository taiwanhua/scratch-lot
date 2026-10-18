import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  type MatrixModuleNode,
  type PermissionGrant,
  expandGrant,
  isSubsetOf,
  isWildcardKey,
  normalizeGrant,
  permissionAction,
  wildcardKeyOf,
} from "@repo/domain/permission";

import { AuditService } from "../audit/audit.service";
import type { Persisted } from "../database/base.repository";
import {
  type ModuleDocument,
  ModulesRepository,
  type PermissionDocument,
  PermissionsRepository,
  RolesRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { RelationService } from "../database/relation.service";
import { parseFormPermissionKey } from "../forms/form-permission-keys";
import { TENANT_ADMIN_ROLE_KEY } from "../orgs/owner-protection.service";
import { ForeignFormPermissions } from "../permission/foreign-form-permissions";
import { ModuleSidebarType } from "../permission/models/me-module.model";
import { PermissionResolver } from "../permission/permission-resolver";
import type { SaveRoleMatrixInput } from "./dto/save-role-matrix.input";
import type {
  RoleGrant,
  RoleMatrixModule,
  RoleMatrixPayload,
} from "./models/role-matrix.model";
import {
  type RoleOperatorFacts,
  type RoleRecord,
  isSeedRole,
  isShrinkOnly,
  isTemplateCopy,
} from "./role-rules";
import { RoleScopeService } from "./role-scope.service";
import { forbiddenError, roleError } from "./roles-error";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPE } from "./roles.service";

type ModuleRecord = Persisted<ModuleDocument>;
type PermissionRecord = Persisted<PermissionDocument>;

/** 讀全域資料(modules / permissions 不掛租戶過濾),兩個範圍在此皆無作用。 */
function globalReader(operator: OperatorContext): OperatorContext {
  return {
    actorId: operator.actorId,
    currentOrgId: operator.currentOrgId,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: operator.memberOrgIds,
    roleIds: operator.roleIds,
  };
}

const SIDEBAR_TYPE_BY_VALUE: Record<string, ModuleSidebarType> = {
  group: ModuleSidebarType.GROUP,
  link: ModuleSidebarType.LINK,
  hidden: ModuleSidebarType.HIDDEN,
};

/**
 * 權限矩陣(`system.role-manager.edit-matrix`)。
 *
 * 規則正本是 ADR-0004 與 docs/modules/role-manager.md「權限矩陣規則」;
 * **正規化與 subset 判斷一律呼叫 `@repo/domain/permission`**(`normalizeGrant` / `isSubsetOf` /
 * `expandGrant`),前後端同一份,本檔不自己再算一次(STRUCT-07)。
 *
 * 一次請求算出**兩棵樹**,分工明確:
 * - `fullTree`(全樹):全部 enabled 模組(停用連子樹剔除)+ 各模組全部 enabled 權限。
 *   **所有正規化與比對都對它做** — `*` 的收斂語意是「這一層的每一筆都給了」,
 *   餵一棵被裁過的樹會讓「操作者只看得到 5 筆,勾滿 5 筆」被收斂成 `*` 而擴權
 * - `matrixTree`(顯示樹):`fullTree` 再交集操作者自身的有效權限集(ADR-0004 防越權:
 *   只能授出自身有的;超級管理員 = 全部)。矩陣上沒出現的就是勾不到的,UI 不必自己再算防越權
 *
 * 整份覆蓋只動「操作者搆得到」的範圍(同 `assignUserRoles`「操作者觸及不到的既有授予不動」):
 * 加的一定在他的權限集內(subset 檢查保證),刪的只刪他本來就搆得到的那些。
 */
@Injectable()
export class RoleMatrixService {
  constructor(
    private readonly modules: ModulesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly roles: RolesRepository,
    private readonly relations: RelationService,
    private readonly audit: AuditService,
    private readonly scope: RoleScopeService,
    private readonly resolver: PermissionResolver,
    private readonly foreignForms: ForeignFormPermissions,
  ) {}

  /** 矩陣的讀取:顯示樹 + 這個角色在顯示樹內的綁定。 */
  async matrix(
    operator: OperatorContext,
    roleId: string,
  ): Promise<RoleMatrixPayload> {
    const role = await this.scope.loadManagedRole(operator, roleId);
    const [facts, view] = await Promise.all([
      this.scope.factsOf(operator, role),
      this.buildView(operator),
    ]);
    const ceiling = await this.ceilingOf(operator, role, view);
    return this.payload(operator, role, view, facts, ceiling);
  }

  /**
   * 人員條件的權限選項(AudiencePicker 的模組 / 權限樹):就是矩陣的**顯示樹** ——
   * 全部 enabled 模組與權限,扣掉別租戶客製表單的欄位級權限(`foreignFieldPermissionKeys`),
   * 再交集操作者自身的有效權限集。根組織操作者(租戶 = null)只看得到共用表單的欄位級權限,
   * 也就是只列底座與專案的權限。
   */
  async permissionOptions(
    operator: OperatorContext,
  ): Promise<RoleMatrixModule[]> {
    const view = await this.buildView(operator);
    return view.matrixTree;
  }

  /**
   * 整份覆蓋(role-manager.md 權限表「編輯權限矩陣」):
   * 1. 以**全樹**正規化送進來的授予(`normalizeGrant`:樹外丟棄、勾下層補上層、`*` 收斂)
   * 2. subset-only 防越權:正規化後要是操作者有效權限集的子集,否則 `ROLE_OUT_OF_REACH`
   * 3. 預設角色(租戶副本)的天花板:還要是**內建「租戶管理員」模板角色目前授予**的子集,
   *    否則 `ROLE_OUT_OF_REACH` + `reason TEMPLATE_CEILING`(root 也擋)
   * 4. 租戶管理員副本只能縮不能擴:還要是**目前綁定**的子集,否則同樣 `ROLE_OUT_OF_REACH`
   * 5. 差集寫入 `role_module` / `role_permission`(刪只刪操作者搆得到的)
   */
  async save(
    operator: OperatorContext,
    input: SaveRoleMatrixInput,
  ): Promise<RoleMatrixPayload> {
    const role = await this.scope.loadManagedRole(operator, input.roleId);
    await this.assertNoForeignFieldPermissions(operator, input.permissionKeys);
    // 種子角色的矩陣唯讀(規則表):內容隨底座版本更新,改了會被下一次 seed 蓋回去
    if (isSeedRole(role)) {
      throw forbiddenError(
        `Role ${input.roleId} is a seed role; its permission matrix is read-only`,
        "SYSTEM_ROLE",
      );
    }
    const facts = await this.scope.factsOf(operator, role);
    const view = await this.buildView(operator);
    const currentRaw = await this.currentGrant(role._id, view);
    const desired = normalizeGrant(view.fullTree, {
      moduleKeys: input.moduleKeys,
      permissionKeys: input.permissionKeys,
    });

    // 防越權(ADR-0004「操作者只能授出自身有效權限集的子集」);模組勾選同理
    if (!isSubsetOf(desired, view.holder)) {
      throw roleError(
        "ROLE_OUT_OF_REACH",
        "The submitted matrix is not a subset of the operator's effective modules and permissions",
      );
    }
    // 預設角色的天花板:矩陣上限 = 內建「租戶管理員」模板角色目前的授予
    // (seed:所有非根組織專屬模組各一筆 `*`)。root 在此範圍內放寬與收窄,
    // **連 root 也開不出模板沒有的東西** —— 租戶作業 / 模組與權限 / 資料範圍是根組織專屬。
    const ceiling = await this.ceilingOf(operator, role, view);
    if (ceiling !== null && !isSubsetOf(desired, ceiling)) {
      throw roleError(
        "ROLE_OUT_OF_REACH",
        "A tenant-admin copy cannot exceed the built-in tenant-admin template's grant",
        "TEMPLATE_CEILING",
      );
    }
    // 預設角色(租戶副本)對**非根組織**的操作者只能縮不能擴(ADR-0009;root 不受此限):
    // 平台方本來就該能替租戶開新模組,租戶自己只能收窄
    if (
      isShrinkOnly(role, facts) &&
      !isSubsetOf(desired, normalizeGrant(view.fullTree, currentRaw))
    ) {
      throw roleError(
        "ROLE_OUT_OF_REACH",
        "A tenant-admin copy can only be narrowed outside the root org; the submitted matrix adds modules or permissions",
      );
    }

    const changed = await this.apply(
      operator,
      role._id,
      view,
      currentRaw,
      desired,
    );
    if (changed) {
      await this.audit.record(operator, {
        action: AUDIT_ACTIONS.editMatrix,
        targetType: AUDIT_TARGET_TYPE,
        targetId: role._id,
        before: {
          moduleKeys: [...currentRaw.moduleKeys],
          permissionKeys: [...currentRaw.permissionKeys],
        },
        after: {
          moduleKeys: [...desired.moduleKeys],
          permissionKeys: [...desired.permissionKeys],
        },
      });
    }
    return this.payload(operator, role, view, facts, ceiling);
  }

  // ---- 內部 ----

  private async payload(
    operator: OperatorContext,
    role: RoleRecord,
    view: MatrixView,
    facts: RoleOperatorFacts,
    ceiling: PermissionGrant | null,
  ): Promise<RoleMatrixPayload> {
    const currentRaw = await this.currentGrant(role._id, view);
    return {
      role: await this.scope.decorateOne(operator, role),
      modules: view.matrixTree,
      granted: visibleGrant(view, currentRaw),
      shrinkOnly: isShrinkOnly(role, facts),
      ceiling: ceiling === null ? null : visibleGrant(view, ceiling),
    };
  }

  /**
   * 預設角色(租戶副本)的天花板:**內建「租戶管理員」模板角色目前的授予**,
   * 對全樹正規化。其他種類的角色沒有天花板(回 `null`)—— 自建角色的上限是
   * 操作者自身的有效權限集(ADR-0004 subset-only),種子角色的矩陣根本唯讀。
   *
   * 讀的是模板角色**現在**的 `role_module` / `role_permission`,不是 seed 宣告的副本 ——
   * 天花板要跟著底座的模板走(新模組加進模板即自動納入),而不是複製當下的快照。
   * 模板角色不存在(資料庫沒跑過 seed)時回 `null`:天花板判不出來就不擋,
   * 既有的 subset-only 與 `shrinkOnly` 兩道仍在。
   */
  private async ceilingOf(
    operator: OperatorContext,
    role: RoleRecord,
    view: MatrixView,
  ): Promise<PermissionGrant | null> {
    if (!isTemplateCopy(role)) {
      return null;
    }
    const template = await this.roles.findOne(globalReader(operator), {
      key: TENANT_ADMIN_ROLE_KEY,
    });
    if (template === null) {
      return null;
    }
    return normalizeGrant(
      view.fullTree,
      await this.currentGrant(template._id, view),
    );
  }

  private async buildView(operator: OperatorContext): Promise<MatrixView> {
    const reader = globalReader(operator);
    const [allModules, allPermissions] = await Promise.all([
      this.modules.findMany(reader, {}),
      // 已退役的欄位級權限(表單新版本不再宣告)不進矩陣:授了也沒有欄位用它;
      // 既有的綁定照留(`currentGrant` 只認矩陣裡的 key,不會因此被清掉)
      this.permissions.findMany(reader, { enabled: true, retiredAt: null }),
    ]);
    // 停用的模組(連子樹)與停用的權限不進矩陣:勾了也不生效(ADR-0011 的剔除規則)
    const liveModules = pruneDisabledSubtrees(allModules);
    const liveIds = new Set(liveModules.map((module) => String(module._id)));
    // 別租戶客製表單的動態權限不進矩陣(與 `PermissionResolver.resolve` 同一份判斷):
    // 全樹也要剔除,否則 `*` 的收斂會把看不到的 key 算進去
    const foreign = await this.foreignForms.keysOf(reader, allPermissions);
    const livePermissions = allPermissions.filter(
      (permission) =>
        liveIds.has(String(permission.moduleId)) &&
        !foreign.has(permission.key),
    );
    const fullTree = buildMatrixTree(liveModules, livePermissions);

    const holder = normalizeGrant(
      fullTree,
      await this.holderGrant(operator, liveModules, livePermissions),
    );
    const holderModuleKeys = new Set(holder.moduleKeys);
    const visibleModules = liveModules.filter((module) =>
      holderModuleKeys.has(module.key),
    );
    // 擁有模組以 `moduleId` 為準,不切字串(ADR-0004「反向歸屬不解析字串」)
    const moduleKeyById = new Map(
      visibleModules.map((module) => [String(module._id), module.key]),
    );
    const visiblePermissions = livePermissions.filter((permission) => {
      const ownerKey = moduleKeyById.get(String(permission.moduleId));
      return (
        ownerKey !== undefined &&
        isSubsetOf({ moduleKeys: [], permissionKeys: [permission.key] }, holder)
      );
    });

    return {
      holder,
      fullTree,
      matrixTree: buildMatrixTree(visibleModules, visiblePermissions),
      visibleModuleKeys: new Set(visibleModules.map((module) => module.key)),
      visiblePermissionKeys: new Set(
        visiblePermissions.map((permission) => permission.key),
      ),
      moduleIdByKey: new Map(
        liveModules.map((module) => [module.key, module._id]),
      ),
      permissionIdByKey: new Map(
        livePermissions.map((permission) => [permission.key, permission._id]),
      ),
    };
  }

  /** 送進來的 key 若是別租戶(或不存在)表單的動態權限 → `ROLE_OUT_OF_REACH`。 */
  private async assertNoForeignFieldPermissions(
    operator: OperatorContext,
    keys: readonly string[],
  ): Promise<void> {
    if (!keys.some((key) => parseFormPermissionKey(key) !== null)) {
      return;
    }
    const permissions = await this.permissions.findMany(
      globalReader(operator),
      { key: { $in: [...keys] }, source: "dynamic" },
    );
    const foreign = await this.foreignForms.keysOf(
      globalReader(operator),
      permissions,
    );
    if (foreign.size > 0) {
      throw roleError(
        "ROLE_OUT_OF_REACH",
        `Dynamic permissions of another tenant's forms cannot be granted: ${[...foreign].join(", ")}`,
      );
    }
  }

  /**
   * 操作者的有效權限集,表成一份授予(`PermissionGrant`)。
   * 超級管理員 → 整棵 enabled 樹 + 每個模組的 `*`(ADR-0004 bypass,不靠權限記錄);
   * 一般操作者 → `PermissionResolver` 的結果(已做 enabled 剔除與 wildcard 展開,ADR-0011)。
   */
  private async holderGrant(
    operator: OperatorContext,
    liveModules: ModuleRecord[],
    livePermissions: PermissionRecord[],
  ): Promise<PermissionGrant> {
    if (!operator.actorId) {
      return { moduleKeys: [], permissionKeys: [] };
    }
    const resolution = await this.resolver.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    if (resolution.isSuperAdmin) {
      return {
        moduleKeys: liveModules.map((module) => module.key),
        permissionKeys: [
          ...liveModules.map((module) => wildcardKeyOf(module.key)),
          ...livePermissions.map((permission) => permission.key),
        ],
      };
    }
    return {
      moduleKeys: resolution.modules.map((module) => module.key),
      permissionKeys: [...resolution.permissionKeys],
    };
  }

  /** 角色目前的綁定,以 key 表示(**照資料庫原樣**:`*` 維持單筆、不補上層、不收斂)。 */
  private async currentGrant(
    roleId: Types.ObjectId,
    view: MatrixView,
  ): Promise<PermissionGrant> {
    const [moduleIds, permissionIds] = await Promise.all([
      this.relations.listModuleIdsOfRoles([roleId]),
      this.relations.listPermissionIdsOfRoles([roleId]),
    ]);
    const moduleKeyById = invert(view.moduleIdByKey);
    const permissionKeyById = invert(view.permissionIdByKey);
    return {
      moduleKeys: moduleIds.flatMap(
        (id) => moduleKeyById.get(String(id)) ?? [],
      ),
      permissionKeys: permissionIds.flatMap(
        (id) => permissionKeyById.get(String(id)) ?? [],
      ),
    };
  }

  /** 差集寫入;回傳是否真的動到資料(沒動就不寫稽核)。 */
  private async apply(
    operator: OperatorContext,
    roleId: Types.ObjectId,
    view: MatrixView,
    current: PermissionGrant,
    desired: PermissionGrant,
  ): Promise<boolean> {
    const currentModules = new Set(current.moduleKeys);
    const desiredModules = new Set(desired.moduleKeys);
    const currentPermissions = new Set(current.permissionKeys);
    const desiredPermissions = new Set(desired.permissionKeys);

    const moduleAdds = desired.moduleKeys.filter(
      (key) => !currentModules.has(key),
    );
    // 只刪操作者搆得到的:他看不到的綁定不該被順手清掉
    const moduleRemoves = current.moduleKeys.filter(
      (key) => !desiredModules.has(key) && view.visibleModuleKeys.has(key),
    );
    // 只刪操作者搆得到的;刪掉的不算數,所以先算刪、再用「留下來的」判斷要不要補
    const permissionRemoves = current.permissionKeys.filter(
      (key) =>
        !desiredPermissions.has(key) &&
        isSubsetOf({ moduleKeys: [], permissionKeys: [key] }, view.holder),
    );
    const removedPermissions = new Set(permissionRemoves);
    const keptPermissions = {
      moduleKeys: [],
      permissionKeys: current.permissionKeys.filter(
        (key) => !removedPermissions.has(key),
      ),
    };
    const permissionAdds = desired.permissionKeys.filter(
      (key) =>
        !currentPermissions.has(key) &&
        // 已被「留下來的 `*`」涵蓋的個別權限不重複寫入(操作者搆不到那筆 `*`,刪不掉也不必補)
        !isSubsetOf({ moduleKeys: [], permissionKeys: [key] }, keptPermissions),
    );

    await this.relations.linkMany(operator, [
      ...linksOf("role_module", roleId, moduleAdds, view.moduleIdByKey),
      ...linksOf(
        "role_permission",
        roleId,
        permissionAdds,
        view.permissionIdByKey,
      ),
    ]);
    await this.relations.unlinkMany(operator, [
      ...linksOf("role_module", roleId, moduleRemoves, view.moduleIdByKey),
      ...linksOf(
        "role_permission",
        roleId,
        permissionRemoves,
        view.permissionIdByKey,
      ),
    ]);
    return (
      moduleAdds.length +
        moduleRemoves.length +
        permissionAdds.length +
        permissionRemoves.length >
      0
    );
  }
}

/** 一次請求算好的「操作者視角」:兩棵樹 + 自身有效權限集 + key ↔ id 對照。 */
interface MatrixView {
  /** 操作者自身的有效權限集(已對全樹正規化)。 */
  holder: PermissionGrant;
  /** 全部 enabled 模組與權限:正規化與比對的基準。 */
  fullTree: readonly MatrixModuleNode[];
  /** 顯示樹(全樹 ∩ 操作者有效權限集),GraphQL 形狀。 */
  matrixTree: RoleMatrixModule[];
  visibleModuleKeys: ReadonlySet<string>;
  visiblePermissionKeys: ReadonlySet<string>;
  moduleIdByKey: ReadonlyMap<string, Types.ObjectId>;
  permissionIdByKey: ReadonlyMap<string, Types.ObjectId>;
}

/**
 * 一份授予 → 顯示用的形狀(`granted` 與 `ceiling` 同一套投影):
 * 先對**全樹**展開(`X.*` → 同層各筆;操作者搆不到的 `*` 也要讓他看到底下那幾列),
 * 再收到顯示樹內 —— 矩陣上沒有的列,回了前端也用不到。
 */
function visibleGrant(view: MatrixView, grant: PermissionGrant): RoleGrant {
  const expanded = expandGrant(view.fullTree, grant);
  return {
    moduleKeys: expanded.moduleKeys.filter((key) =>
      view.visibleModuleKeys.has(key),
    ),
    permissionKeys: expanded.permissionKeys.filter((key) =>
      view.visiblePermissionKeys.has(key),
    ),
  };
}

function invert(
  byKey: ReadonlyMap<string, Types.ObjectId>,
): Map<string, string> {
  return new Map([...byKey].map(([key, id]) => [String(id), key]));
}

function linksOf(
  type: "role_module" | "role_permission",
  roleId: Types.ObjectId,
  keys: readonly string[],
  idByKey: ReadonlyMap<string, Types.ObjectId>,
): {
  type: "role_module" | "role_permission";
  firstId: Types.ObjectId;
  secondId: Types.ObjectId;
}[] {
  return keys.flatMap((key) => {
    const id = idByKey.get(key);
    return id === undefined ? [] : [{ type, firstId: roleId, secondId: id }];
  });
}

/**
 * 剔除自己或任一祖先 enabled=false 的模組(ADR-0011;與 PermissionResolver 同一條規則)。
 * 停用的模組不該出現在矩陣上 — 勾了也不生效,徒增誤會。
 */
function pruneDisabledSubtrees(modules: ModuleRecord[]): ModuleRecord[] {
  const byId = new Map(modules.map((module) => [String(module._id), module]));
  return modules.filter(
    (module) =>
      module.enabled &&
      module.ancestors.every(
        (ancestorId) => byId.get(String(ancestorId))?.enabled === true,
      ),
  );
}

/** 組樹:深度優先、同層依 order → key(與 `me.modules` 同一套排序)。 */
function buildMatrixTree(
  modules: ModuleRecord[],
  permissions: PermissionRecord[],
): RoleMatrixModule[] {
  const permissionsByModule = new Map<string, PermissionRecord[]>();
  for (const permission of permissions) {
    const key = String(permission.moduleId);
    permissionsByModule.set(key, [
      ...(permissionsByModule.get(key) ?? []),
      permission,
    ]);
  }
  const childrenByParent = new Map<string, ModuleRecord[]>();
  for (const module of modules) {
    const key = module.parentId === null ? "" : String(module.parentId);
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), module]);
  }

  const build = (module: ModuleRecord): RoleMatrixModule => ({
    id: String(module._id),
    key: module.key,
    name: module.name,
    parentId: module.parentId === null ? null : String(module.parentId),
    sidebarType:
      SIDEBAR_TYPE_BY_VALUE[module.sidebarType] ?? ModuleSidebarType.HIDDEN,
    order: module.order,
    description: module.description ?? null,
    // `*` 排在同層第一列(矩陣的「全部」列),其餘依 key
    permissions: (permissionsByModule.get(String(module._id)) ?? [])
      .toSorted(comparePermissions)
      .map((permission) => ({
        id: String(permission._id),
        key: permission.key,
        name: permission.name,
        description: permission.description ?? null,
        action: permissionAction(permission.key),
      })),
    children: (childrenByParent.get(String(module._id)) ?? [])
      .toSorted(compareModules)
      .map((child) => build(child)),
  });

  return (childrenByParent.get("") ?? [])
    .toSorted(compareModules)
    .map((module) => build(module));
}

function compareModules(a: ModuleRecord, b: ModuleRecord): number {
  return a.order - b.order || a.key.localeCompare(b.key);
}

function comparePermissions(a: PermissionRecord, b: PermissionRecord): number {
  const wildcardFirst =
    Number(isWildcardKey(b.key)) - Number(isWildcardKey(a.key));
  return wildcardFirst || a.key.localeCompare(b.key);
}
