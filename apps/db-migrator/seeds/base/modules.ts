import { isModuleIconKey } from "@repo/domain/module-icon";

import { SeedCompositionError } from "../../src/seed/seed-composition";
import {
  type SeedDocument,
  type SeedDocumentSet,
  type SeedRelationSet,
  seedRef,
} from "../../src/seed/seed-declaration";
import {
  DATA_SCOPE_TARGETS_COLLECTION,
  MODULES_COLLECTION,
  PERMISSIONS_COLLECTION,
} from "../../src/seed/seed-key-convention";
import {
  type ModuleInitialValue,
  type ModuleInitialValues,
  type ModuleNodeDeclaration,
  type ModuleSeedDeclaration,
  type PermissionDeclaration,
  wildcardPermission,
} from "./module-declaration";
import { apiModules } from "./modules/api";
import { applyCenterModule } from "./modules/apply-center";
import { demoFormModule } from "./modules/demo-form";
import { demoGroupFormModule } from "./modules/demo.form";
import { sampleTwoModule } from "./modules/demo.sample-two";
import { demoSubGroupFormModule } from "./modules/demo.sub.form";
import { sampleOneModule } from "./modules/demo.sub.sample-one";
import { overviewModule } from "./modules/overview";
import { systemModules } from "./modules/system";
import { tenantAdminBindingsOf } from "./role-bindings";

/**
 * 底座的模組宣告(ADR-0002:每模組一檔,在此收齊)。順序即宣告順序:父在前
 * (跨檔引用的父 — 如示範模組2 與示範表單掛 `demo` / `demo.sub` — 由 sample-one 檔先宣告)。
 * 專案的模組宣告在 `seeds/project/registry.ts`,兩方由 `seeds/registry.ts` 合併後交給 `composeModuleSeeds`。
 */
export const baseModuleDeclarations: readonly ModuleSeedDeclaration[] = [
  overviewModule,
  systemModules,
  apiModules,
  sampleOneModule,
  sampleTwoModule,
  demoGroupFormModule,
  demoSubGroupFormModule,
  demoFormModule,
  applyCenterModule,
];

/** 由全部模組宣告推導出的四類種子(只推導一次;其他來源不得再宣告這些內容)。 */
export interface ModuleSeeds {
  modules: SeedDocumentSet;
  permissions: SeedDocumentSet;
  dataScopeTargets: SeedDocumentSet;
  tenantAdminBindings: SeedRelationSet;
}

/** 模組初值能指定的欄位(`ModuleInitialValue`);其餘欄位由宣告決定。 */
const MODULE_INITIAL_VALUE_FIELDS: readonly string[] = [
  "enabled",
  "icon",
  "settings",
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 重複的 key(每個只列一次)。 */
function duplicatesOf(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      duplicated.add(key);
    }
    seen.add(key);
  }
  return [...duplicated];
}

/**
 * 依整棵樹把節點排成「父在前」(同層維持宣告順序),並找出撞 key、父節點未宣告與循環。
 * 專案的子模組可以掛在底座的父節點底下,所以排序看的是合併後的整棵樹,不是各來源自己的順序。
 */
function orderNodes(nodes: readonly ModuleNodeDeclaration[]): {
  ordered: ModuleNodeDeclaration[];
  problems: string[];
} {
  const problems = duplicatesOf(nodes.map((node) => node.key)).map(
    (key) => `模組 ${key} 重複宣告(底座與專案不能宣告同一個模組 key)`,
  );
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const ordered: ModuleNodeDeclaration[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: ModuleNodeDeclaration, trail: string[]): void => {
    const current = state.get(node.key);
    if (current === "done") {
      return;
    }
    if (current === "visiting") {
      problems.push(`模組父子關係循環:${[...trail, node.key].join(" → ")}`);
      return;
    }
    state.set(node.key, "visiting");
    if (node.parentKey !== null) {
      const parent = byKey.get(node.parentKey);
      if (parent === undefined) {
        problems.push(`模組 ${node.key} 的上層模組 ${node.parentKey} 未宣告`);
      } else {
        visit(parent, [...trail, node.key]);
      }
    }
    state.set(node.key, "done");
    ordered.push(node);
  };
  for (const node of byKey.values()) {
    visit(node, []);
  }
  return { ordered, problems };
}

/** 模組初值:只能指到已宣告的模組、只能給三個欄位,值的型別要對。 */
function initialValueProblems(
  moduleInitialValues: ModuleInitialValues,
  moduleKeys: ReadonlySet<string>,
): string[] {
  return Object.entries(moduleInitialValues).flatMap(([key, value]) => {
    const at = `moduleInitialValues.${key}`;
    return moduleKeys.has(key)
      ? initialValueProblemsOf(at, value)
      : [`${at}:模組 ${key} 未宣告`];
  });
}

/** 一個模組的初值指定(型別只保證編譯期,執行期照 unknown 再驗)。 */
function initialValueProblemsOf(at: string, value: unknown): string[] {
  if (!isPlainRecord(value)) {
    return [`${at} 必須是物件`];
  }
  const problems = Object.keys(value)
    .filter((field) => !MODULE_INITIAL_VALUE_FIELDS.includes(field))
    .map(
      (field) =>
        `${at}.${field} 不是可指定的初值(只收 ${MODULE_INITIAL_VALUE_FIELDS.join("、")})`,
    );
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    problems.push(`${at}.enabled 必須是 true / false`);
  }
  if (
    value.icon !== undefined &&
    value.icon !== null &&
    !isModuleIconKey(value.icon)
  ) {
    problems.push(`${at}.icon 不在圖示白名單內`);
  }
  if (value.settings !== undefined && !isPlainRecord(value.settings)) {
    problems.push(`${at}.settings 必須是物件`);
  }
  return problems;
}

/**
 * 宣告資料範圍目標的模組 = 宣告檔中第一個非群組節點:
 * 模組檔先宣告群組(如示範家族的 `demo` / `demo.sub`)、再宣告模組本身,隱藏頁在後。
 */
function ownerModuleKeyOf(declaration: ModuleSeedDeclaration): string | null {
  return (
    declaration.nodes.find((node) => node.sidebarType !== "group")?.key ?? null
  );
}

interface DataScopeTargetEntry {
  moduleKey: string;
  target: NonNullable<ModuleSeedDeclaration["dataScopeTarget"]>;
}

function dataScopeTargetsOf(declarations: readonly ModuleSeedDeclaration[]): {
  entries: DataScopeTargetEntry[];
  problems: string[];
} {
  const entries: DataScopeTargetEntry[] = [];
  const problems: string[] = [];
  for (const declaration of declarations) {
    if (!declaration.dataScopeTarget) {
      continue;
    }
    const moduleKey = ownerModuleKeyOf(declaration);
    if (moduleKey === null) {
      problems.push("宣告 dataScopeTarget 的模組檔至少要有一個非群組節點");
      continue;
    }
    entries.push({ moduleKey, target: declaration.dataScopeTarget });
  }
  problems.push(
    ...duplicatesOf(entries.map((entry) => entry.moduleKey)).map(
      (key) => `模組 ${key} 宣告了兩個資料範圍目標(一個模組至多一個)`,
    ),
  );
  return { entries, problems };
}

/**
 * 由**全部**模組宣告(底座 + 專案)推導 modules、permissions、dataScopeTargets 與租戶管理員模板。
 *
 * 只在固定組裝入口呼叫一次:父路徑(ancestors)與根組織專屬的繼承都看合併後的整棵樹,
 * 模板也才會納入專案新增的模組(底座只看自己的模組會漏)。撞 key、父節點未宣告、循環、
 * 權限指到未宣告的模組、未知的模組初值都在這裡拒絕,不留到寫入時才發現。
 */
export function composeModuleSeeds(
  declarations: readonly ModuleSeedDeclaration[],
  moduleInitialValues: ModuleInitialValues,
): ModuleSeeds {
  const { ordered: nodes, problems } = orderNodes(
    declarations.flatMap((declaration) => declaration.nodes),
  );
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  /** 每個模組自動一筆 wildcard(含群組、隱藏頁、api 樹;只代表該模組自己這一層)+ 各模組檔宣告的個別權限。 */
  const permissionDeclarations: PermissionDeclaration[] = [
    ...nodes.map((node) => wildcardPermission(node)),
    ...declarations.flatMap((declaration) => declaration.permissions ?? []),
  ];
  const targets = dataScopeTargetsOf(declarations);
  problems.push(
    ...duplicatesOf(permissionDeclarations.map((entry) => entry.key)).map(
      (key) => `權限 ${key} 重複宣告(底座與專案不能宣告同一個權限 key)`,
    ),
    ...permissionDeclarations
      .filter((permission) => !nodeByKey.has(permission.moduleKey))
      .map(
        (permission) =>
          `權限 ${permission.key} 的擁有模組 ${permission.moduleKey} 未宣告`,
      ),
    ...targets.problems,
    ...initialValueProblems(moduleInitialValues, new Set(nodeByKey.keys())),
  );
  if (problems.length > 0) {
    throw new SeedCompositionError(problems);
  }

  /** 由根到父的祖先 key(物化路徑,ADR-0005);前面已確認父節點都在、沒有循環。 */
  const ancestorKeys = (node: ModuleNodeDeclaration): string[] => {
    const keys: string[] = [];
    let parent =
      node.parentKey === null ? undefined : nodeByKey.get(node.parentKey);
    while (parent !== undefined) {
      keys.unshift(parent.key);
      parent =
        parent.parentKey === null ? undefined : nodeByKey.get(parent.parentKey);
    }
    return keys;
  };
  /** 根組織專屬:自己或任一祖先標 isRootOnly(ADR-0009 模板扣除之)。 */
  const isRootOnlyModule = (key: string): boolean => {
    const node = nodeByKey.get(key);
    return (
      node !== undefined &&
      [node.key, ...ancestorKeys(node)].some(
        (candidate) => nodeByKey.get(candidate)?.isRootOnly === true,
      )
    );
  };

  return {
    /**
     * 模組樹(全部節點;正本:docs/modules/*.md)。
     *
     * `enabled`、`icon`、`settings` 是「初始 seed 值的欄位」(ADR-0002),都是人在畫面上管的值,
     * 下次部署重跑 seed 不會被宣告值翻回去:
     * - `icon`:根組織在「模組與權限」頁換的圖示(`setModuleIcon` 清空時寫的是 `null`,欄位仍在,所以也算人改過的值)
     * - `settings`:表單模組的列表欄位配置存在 `settings.list`(root 在「列表欄位」設定改)
     */
    modules: {
      kind: "documents",
      collection: MODULES_COLLECTION,
      initialSeedValueFields: ["enabled", "icon", "settings"],
      entries: nodes.map((node) =>
        toModuleDocument(
          node,
          ancestorKeys(node),
          moduleInitialValues[node.key],
        ),
      ),
    },
    /**
     * 權限(每模組一筆 wildcard + 各模組宣告的個別權限;正本:docs/modules/*.md 權限表)。
     *
     * **只碰 `source: seed` 的權限**:表單發布會在同一張表建 `source: "dynamic"` 的欄位級權限,
     * seed 既不比對、也不更新它們(`match` 排除 dynamic;runner 本來就不刪不認識的文件)。
     * 條件寫成「不是 dynamic」而不是「是 seed」:欄位加上之前的舊文件沒有 `source`,
     * 要讓它們照樣被認成 seed 權限並補上 `source: "seed"`。
     */
    permissions: {
      kind: "documents",
      collection: PERMISSIONS_COLLECTION,
      match: { source: { $ne: "dynamic" } },
      entries: permissionDeclarations.map((permission) =>
        toPermissionDocument(permission),
      ),
    },
    /**
     * 資料範圍目標(ADR-0008;識別鍵 `(collection, moduleKey)`,schema 無 key 欄位)。
     *
     * runner 以 `moduleKey` 找文件:每個模組至多宣告一個目標,所以 moduleKey 單獨就能認出是哪一筆
     * (唯一索引仍是 `(collection, moduleKey)`,同一張表可以有多個模組各一個目標)。
     * `moduleKey` = 宣告檔的第一個**非群組**節點(該模組本身;群組在前、隱藏頁在後,見 `ownerModuleKeyOf`)。
     */
    dataScopeTargets: {
      kind: "documents",
      collection: DATA_SCOPE_TARGETS_COLLECTION,
      keyField: "moduleKey",
      entries: targets.entries.map(({ moduleKey, target }) => ({
        key: moduleKey,
        data: {
          collection: target.collection,
          name: target.name,
          ...(target.description === undefined
            ? {}
            : { description: target.description }),
          fields: target.fields,
        },
      })),
    },
    tenantAdminBindings: tenantAdminBindingsOf(
      nodes,
      permissionDeclarations,
      isRootOnlyModule,
    ),
  };
}

/** 模組節點 → modules 文件(欄位形狀:module.schema.ts;key/isSystem 由 runner 補)。 */
function toModuleDocument(
  node: ModuleNodeDeclaration,
  ancestors: readonly string[],
  initial: ModuleInitialValue | undefined,
): SeedDocument {
  return {
    key: node.key,
    data: {
      name: node.name,
      parentId:
        node.parentKey === null
          ? null
          : seedRef(MODULES_COLLECTION, node.parentKey),
      ancestors: ancestors.map((ancestorKey) =>
        seedRef(MODULES_COLLECTION, ancestorKey),
      ),
      ...(node.route === undefined ? {} : { route: node.route }),
      sidebarType: node.sidebarType,
      order: node.order,
      // 初始 seed 值(見 modules 的 initialSeedValueFields):建立後由人在系統內管理;專案可在 moduleInitialValues 指定
      enabled: initial?.enabled ?? true,
      // 沒宣告圖示的節點(多數隱藏頁)落庫為 null = 側欄用預設圖示;根組織可再用 setModuleIcon 指定
      icon: initial?.icon === undefined ? (node.icon ?? null) : initial.icon,
      // 每次都 seed 的欄位:頁面組裝方式由宣告決定,不在系統內改
      engine: node.engine ?? "fixed",
      // 每次都 seed 的欄位:依表單分開新增權限(B9b)只能在宣告開關
      perFormCreate: node.perFormCreate === true,
      ...(node.description === undefined
        ? {}
        : { description: node.description }),
      // 初始 seed 值:`settings.list`(表單模組的列表欄位配置)由 root 在畫面上改
      settings: initial?.settings ?? node.settings ?? {},
    },
  };
}

/** 權限 → permissions 文件(欄位形狀:permission.schema.ts;moduleId 直接欄位,ADR-0001/0004)。 */
function toPermissionDocument(permission: PermissionDeclaration): SeedDocument {
  return {
    key: permission.key,
    data: {
      moduleId: seedRef(MODULES_COLLECTION, permission.moduleKey),
      name: permission.name,
      ...(permission.description === undefined
        ? {}
        : { description: permission.description }),
      enabled: true,
      settings: {},
      // seed 只同步 source = seed 的權限(`permissions` 的 `match`);執行期產生的是 dynamic
      source: "seed",
    },
  };
}
