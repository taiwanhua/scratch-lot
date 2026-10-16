import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { hasPermission, isWildcardKey } from "@repo/domain/permission";

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
import type {
  ModuleEngine,
  ModuleSidebarType,
} from "../database/schemas/module.schema";
import { ForeignFormPermissions } from "./foreign-form-permissions";

/** 超級管理員種子角色 key(apps/db-migrator/seeds/base/roles.ts;isSystem,解析時 bypass,ADR-0004)。 */
export const SUPER_ADMIN_ROLE_KEY = "super-admin";

/** 模組陣列的一筆(ADR-0011 步驟 7;GraphQL 形狀見 models/me-module.model.ts)。 */
export interface ResolvedModule {
  id: Types.ObjectId;
  key: string;
  name: string;
  parentId: Types.ObjectId | null;
  sidebarType: ModuleSidebarType;
  order: number;
  /** 完整路徑(父段累加);非頁面節點(隱藏 `api` 樹)為 null。 */
  route: string | null;
  /** 側欄圖示 key(白名單 `@repo/domain/module-icon`);null = 用預設圖示。 */
  icon: string | null;
  /** 頁面組裝方式(`modules.engine`)。 */
  engine: ModuleEngine;
  /** 有效權限 key(moduleId 等於此模組者)。 */
  permissions: string[];
}

export interface PermissionResolution {
  /** 持有 isSystem 超級管理員角色:全部 enabled 模組與全部權限,不靠權限記錄。 */
  isSuperAdmin: boolean;
  modules: ResolvedModule[];
  /** 有效權限 key 的集合(= 模組陣列內全部 permissions 的聯集),供 @RequirePermission 守門一次查表。 */
  permissionKeys: ReadonlySet<string>;
  /**
   * 被濾掉的別租戶(或不存在)表單動態權限 key(`ForeignFormPermissions`)。不送前端;
   * `holdsPermission` 靠它讓 `<模組>.*` 的同層回退也蓋不到這些 key。
   */
  foreignPermissionKeys: ReadonlySet<string>;
}

/** 判斷持有權限需要的兩個集合(`PermissionResolution` 的子集)。 */
export type PermissionHolding = Pick<
  PermissionResolution,
  "permissionKeys" | "foreignPermissionKeys"
>;

/**
 * **api 端唯一的權限判斷**:持有某權限(含同層 wildcard 回退,`@repo/domain/permission` 的
 * `hasPermission`),但別租戶表單的動態權限一律不持有 —— 即使持有該模組的 `*`。
 * api 端不要直接呼叫 `hasPermission`(會被 `*` 回退繞過);前端只拿得到過濾後的 `me.modules`,照用 `hasPermission`。
 *
 * 已知縫:`foreignPermissionKeys` 只收「展開時讀得到」的權限列(enabled、存在),所以
 * **停用或不存在**的別租戶動態權限 key 不在裡面,持 `*` 時 `hasPermission` 的回退仍會回 true。
 * 這不構成漏洞:沒有任何端點以 `@RequirePermission` 或 `holdsPermission` 要求別租戶的動態權限 key;
 * 欄位級權限的閘門(`forms/field-permission-gate.ts`)只認集合裡的具體 key、不走回退;
 * 別租戶客製表單本身在執行端一律當不存在(`FormAccessService.findRuntimeForm`),拿得到 key 也讀不到資料。
 */
export function holdsPermission(
  resolution: PermissionHolding,
  key: string,
): boolean {
  return (
    !resolution.foreignPermissionKeys.has(key) &&
    hasPermission(resolution.permissionKeys, key)
  );
}

const EMPTY_RESOLUTION: PermissionResolution = {
  isSuperAdmin: false,
  modules: [],
  permissionKeys: new Set(),
  foreignPermissionKeys: new Set(),
};

type ModuleRecord = Persisted<ModuleDocument>;
type PermissionRecord = Persisted<PermissionDocument>;

/**
 * 讀全域 / 關聯歸屬資料(modules、permissions、roles 不受租戶過濾),兩個範圍在此皆無作用;
 * 當前組織只是帶著走,不參與計算(ADR-0003)。
 */
function readerOf(
  userId: Types.ObjectId,
  currentOrgId: Types.ObjectId | null,
): OperatorContext {
  return {
    actorId: userId,
    currentOrgId,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    // 權限解析只碰非租戶資料,走不到資料範圍規則(ADR-0008);明寫空集合(#246 的 6)
    memberOrgIds: [],
    roleIds: [],
  };
}

function idsOf(records: { _id: Types.ObjectId }[]): Types.ObjectId[] {
  return records.map((record) => record._id);
}

/**
 * 權限解析的單一入口(ADR-0003 / ADR-0011):每請求現查,v1 不快取。
 * 步驟(ADR-0011「登入後的查詢步驟」):
 * 2. user_role → roleIds;**停用的角色(roles.enabled=false)不計**(持有超級管理員 → bypass)
 * 3. role_module → moduleIds
 * 4. role_permission → permissionIds → permissions;**停用的權限(permissions.enabled=false,全域 kill switch)不算持有**
 * 5. wildcard 展開:`X.*` → moduleId = X 的全部 enabled 權限(同層,不含子模組)
 * 6. 查 modules(enabled=false 者連子樹剔除),每個模組塞 moduleId 等於它的有效權限
 * 7. 回模組陣列(route 由父段累加成完整路徑)
 *
 * 當前組織不參與角色與權限的計算(ADR-0003);只用來判斷「哪些表單動態權限屬於別租戶」:
 * 步驟 5 之後剔除別租戶客製表單的動態權限(`ForeignFormPermissions`,超級管理員同樣剔除),
 * `me.modules`、`@RequirePermission`、權限矩陣因此看到同一份權限集。
 */
@Injectable()
export class PermissionResolver {
  constructor(
    private readonly relations: RelationService,
    private readonly roles: RolesRepository,
    private readonly modules: ModulesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly foreignForms: ForeignFormPermissions,
  ) {}

  async resolve(
    userId: Types.ObjectId,
    currentOrgId: Types.ObjectId | null,
  ): Promise<PermissionResolution> {
    const reader = readerOf(userId, currentOrgId);
    const roleIds = await this.relations.listRoleIdsOfUser(userId);
    if (roleIds.length === 0) {
      return EMPTY_RESOLUTION;
    }
    // 停用的角色不計(roles.enabled 是「停用這個角色」的開關,授予仍在但不生效)
    const roles = await this.roles.findMany(reader, {
      _id: { $in: roleIds },
      enabled: true,
    });
    if (roles.length === 0) {
      return EMPTY_RESOLUTION;
    }
    const isSuperAdmin = roles.some(
      (role) => role.isSystem && role.key === SUPER_ADMIN_ROLE_KEY,
    );
    return isSuperAdmin
      ? this.resolveSuperAdmin(reader)
      : this.resolveRoles(reader, idsOf(roles));
  }

  /**
   * 這些角色**實際授予**的有效權限(人員條件的「權限」欄用;人員條件看 `permissionKeys` 的成員,
   * 不走 `holdsPermission` 的 `*` 回退 —— 停用的權限不算):
   * 與 `resolve` 同一套步驟 3–6(停用的角色 / 權限不算、`*` 展開、模組連祖先停用剔除、
   * 別租戶客製表單的動態權限剔除),但**不套超級管理員的略過** —— 超級管理員要符合權限條件,
   * 就得真的被授予那個權限(或改用角色 / 指定本人)。
   *
   * `orgId`:「哪些表單動態權限屬於別租戶」以這個組織所屬的租戶判斷(與 `resolve` 的當前組織同義)。
   * 判斷操作者時給他的當前組織;列出某租戶的人時給租戶頂層 —— 兩條路對同一個人才會一致。
   */
  async grantedPermissionKeys(
    roleIds: readonly Types.ObjectId[],
    orgId: Types.ObjectId | null,
  ): Promise<PermissionHolding> {
    if (roleIds.length === 0) {
      return EMPTY_RESOLUTION;
    }
    const reader: OperatorContext = {
      actorId: null,
      currentOrgId: orgId,
      visibleOrgIds: "all",
      managedOrgIds: "all",
      memberOrgIds: [],
      roleIds: [],
    };
    const roles = await this.roles.findMany(reader, {
      _id: { $in: [...roleIds] },
      enabled: true,
    });
    if (roles.length === 0) {
      return EMPTY_RESOLUTION;
    }
    const resolution = await this.resolveRoles(reader, idsOf(roles));
    return {
      permissionKeys: resolution.permissionKeys,
      foreignPermissionKeys: resolution.foreignPermissionKeys,
    };
  }

  /** 超級管理員 bypass(ADR-0004):全部 enabled 模組(含根組織專屬)+ 這些模組的全部權限。 */
  private async resolveSuperAdmin(
    reader: OperatorContext,
  ): Promise<PermissionResolution> {
    const allModules = await this.modules.findMany(reader, {});
    const visibleModules = pruneDisabledSubtrees(allModules);
    // 停用的權限(permissions.enabled = 全域 kill switch)連超級管理員也不給
    const permissions = await this.permissions.findMany(reader, {
      moduleId: { $in: idsOf(visibleModules) },
      enabled: true,
    });
    const foreign = await this.foreignForms.keysOf(reader, permissions);
    return {
      isSuperAdmin: true,
      ...assemble(
        visibleModules,
        allModules,
        withoutKeys(permissions, foreign),
      ),
      foreignPermissionKeys: foreign,
    };
  }

  private async resolveRoles(
    reader: OperatorContext,
    roleIds: Types.ObjectId[],
  ): Promise<PermissionResolution> {
    // 步驟 3、4:兩種關聯各查一次(聯集,ADR-0003)。依序查(TX-02):人員條件的「權限」欄會在
    // 呼叫端的交易內(通知的收件人解析)走到這裡,同一個 session 上不平行讀
    const moduleIds = await this.relations.listModuleIdsOfRoles(roleIds);
    const permissionIds =
      await this.relations.listPermissionIdsOfRoles(roleIds);
    // 停用的權限(permissions.enabled = 全域 kill switch)不算持有,連 `*` 被停用也不展開
    const granted = await this.permissions.findMany(reader, {
      _id: { $in: permissionIds },
      enabled: true,
    });

    // 步驟 5:wildcard 展開 — `X.*` 的 moduleId 就是 X,查 moduleId ∈ 那些模組即同層全部
    const wildcardModuleIds = granted
      .filter((permission) => isWildcardKey(permission.key))
      .map((permission) => permission.moduleId);
    const expanded =
      wildcardModuleIds.length === 0
        ? []
        : await this.permissions.findMany(reader, {
            moduleId: { $in: wildcardModuleIds },
            enabled: true,
          });
    const unfiltered = uniqueById([...granted, ...expanded]);
    // 別租戶客製表單的動態權限:沒有動態權限(沒持表單模組 `*`、也沒被授動態權限)就不查 forms
    const foreign = await this.foreignForms.keysOf(reader, unfiltered);
    const effective = withoutKeys(unfiltered, foreign);

    // 步驟 6:綁定的模組 + 祖先(算 enabled 連動與完整路由要看祖先;樹完整時祖先已在集合內)
    const boundModules = await this.modules.findMany(reader, {
      _id: { $in: moduleIds },
    });
    const knownModules = await this.withAncestors(reader, boundModules);
    const visibleModules = pruneDisabledSubtrees(boundModules, knownModules);
    return {
      isSuperAdmin: false,
      ...assemble(visibleModules, knownModules, effective),
      foreignPermissionKeys: foreign,
    };
  }

  /** 補齊 `modules` 的祖先文件(通常一筆不缺);回傳含祖先的完整清單。 */
  private async withAncestors(
    reader: OperatorContext,
    modules: ModuleRecord[],
  ): Promise<ModuleRecord[]> {
    const known = new Map(
      modules.map((module) => [String(module._id), module]),
    );
    const missingIds = new Map<string, Types.ObjectId>();
    for (const module of modules) {
      for (const ancestorId of module.ancestors) {
        if (!known.has(String(ancestorId))) {
          missingIds.set(String(ancestorId), ancestorId);
        }
      }
    }
    if (missingIds.size === 0) {
      return modules;
    }
    const ancestors = await this.modules.findMany(reader, {
      _id: { $in: [...missingIds.values()] },
    });
    return [...modules, ...ancestors];
  }
}

function withoutKeys<T extends { key: string }>(
  records: T[],
  keys: ReadonlySet<string>,
): T[] {
  return keys.size === 0
    ? records
    : records.filter((record) => !keys.has(record.key));
}

function uniqueById<T extends { _id: Types.ObjectId }>(records: T[]): T[] {
  const byId = new Map(records.map((record) => [String(record._id), record]));
  return [...byId.values()];
}

/**
 * 剔除自己或任一祖先 enabled=false 的模組(「停用父模組時整棵子樹視同停用」,CONTEXT.md)。
 * 樹的完整性(綁下層必綁上層)是權限矩陣 UI 的不變量(ADR-0011 步驟 3),此處不重驗;
 * 祖先文件不存在(資料損毀)才視同停用。
 */
function pruneDisabledSubtrees(
  candidates: ModuleRecord[],
  known: ModuleRecord[] = candidates,
): ModuleRecord[] {
  const byId = new Map(known.map((module) => [String(module._id), module]));
  const isLive = (module: ModuleRecord): boolean =>
    module.enabled &&
    module.ancestors.every(
      (ancestorId) => byId.get(String(ancestorId))?.enabled === true,
    );
  return candidates.filter((module) => isLive(module));
}

/** 步驟 6、7:塞權限、組完整路由、排序(祖先深度 → order → key,前端仍以 parentId 組樹)。 */
function assemble(
  visibleModules: ModuleRecord[],
  knownModules: ModuleRecord[],
  permissions: PermissionRecord[],
): Pick<PermissionResolution, "modules" | "permissionKeys"> {
  const byId = new Map(
    knownModules.map((module) => [String(module._id), module]),
  );
  const visibleIds = new Set(
    visibleModules.map((module) => String(module._id)),
  );
  const keysByModule = new Map<string, string[]>();
  for (const permission of permissions) {
    const moduleId = String(permission.moduleId);
    if (!visibleIds.has(moduleId)) {
      continue;
    }
    keysByModule.set(moduleId, [
      ...(keysByModule.get(moduleId) ?? []),
      permission.key,
    ]);
  }

  const modules = visibleModules
    .map((module): ResolvedModule => {
      const permissionKeys = keysByModule.get(String(module._id)) ?? [];
      return {
        id: module._id,
        key: module.key,
        name: module.name,
        parentId: module.parentId,
        sidebarType: module.sidebarType,
        order: module.order,
        route: fullRouteOf(module, byId),
        icon: module.icon,
        // 欄位加上之前寫入、還沒被 migration 補值的文件,mongoose 讀出時套 schema default(fixed)
        engine: module.engine,
        permissions: permissionKeys.toSorted((a, b) => a.localeCompare(b)),
      };
    })
    .toSorted(compareModules);
  const permissionKeys = new Set(
    modules.flatMap((module) => module.permissions),
  );
  return { modules, permissionKeys };
}

/** 完整路徑 = `/` + 祖先(由根到父)的 route 段 + 自己那段;自己沒有 route(非頁面節點)→ null。 */
function fullRouteOf(
  module: ModuleRecord,
  byId: ReadonlyMap<string, ModuleRecord>,
): string | null {
  if (module.route === undefined || module.route === "") {
    return null;
  }
  const segments = module.ancestors
    .map((ancestorId) => byId.get(String(ancestorId))?.route)
    .filter(
      (segment): segment is string => segment !== undefined && segment !== "",
    );
  return `/${[...segments, module.route].join("/")}`;
}

function compareModules(a: ResolvedModule, b: ResolvedModule): number {
  return a.order - b.order || a.key.localeCompare(b.key);
}
