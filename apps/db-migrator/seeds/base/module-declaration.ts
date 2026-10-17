/**
 * 模組種子的宣告型別與 helper(ADR-0002:底座 `seeds/base/modules/<key>.ts`、專案 `seeds/project/` 每模組一檔 —
 * 模組樹節點 + permissions + dataScopeTarget)。底座與專案共用這一份宣告方式。欄位形狀對照
 * apps/api/src/database/schemas/module.schema.ts、permission.schema.ts、data-scope-target.schema.ts。
 */
import type { ModuleIconKey } from "@repo/domain/module-icon";

/** 側欄呈現型別(module.schema.ts MODULE_SIDEBAR_TYPES)。 */
export type ModuleSidebarType = "group" | "link" | "hidden";

/** 一個模組樹節點;parentId / ancestors 由 seeds/base/modules.ts 依 parentKey 解析(父節點可以在另一個來源)。 */
export interface ModuleNodeDeclaration {
  /** 累加父 key(`<父key>.<自己那段>`),規約由靜態測試強制。 */
  key: string;
  name: string;
  sidebarType: ModuleSidebarType;
  /** 上層模組 key;頂層為 null。 */
  parentKey: string | null;
  /** 同層側欄排序。 */
  order: number;
  /** 只有自己那段(前綴父路由由 API 組合);純 API 樹等非頁面節點不填。 */
  route?: string;
  description?: string;
  /**
   * 側欄圖示 key 的**初始值**(白名單 `@repo/domain/module-icon`;型別即白名單,打錯字 check-types 紅)。
   * 不宣告 = 落庫為 `null`(側欄用預設圖示);建立後由根組織在「模組與權限」頁改,
   * 與 `enabled` 同屬「初始 seed 值的欄位」(ADR-0002),重跑 seed 不覆蓋人改過的值。
   */
  icon?: ModuleIconKey;
  /** 根組織專屬(租戶不可見):租戶管理員模板扣除之(ADR-0009)。 */
  isRootOnly?: boolean;
  /**
   * 表單模組:頁面由表單引擎組裝、資料存 `form_submissions`。落庫到 `modules.engine`
   * (不宣告 = `"fixed"`,固定欄位模組);每次 seed 都同步宣告值。
   */
  engine?: "form";
  /**
   * 表單模組依表單分開新增權限(B9b;只給 `engine: "form"`,由 `formModuleDeclaration` 的 `perFormCreate` 帶入)。
   * 落庫到 `modules.perFormCreate`(不宣告 = false);與 `engine` 一樣每次 seed 都同步宣告值,不提供執行期開關。
   * 已有表單的模組改為開啟需要 migration(補建權限、把原持有模組 `create` 的角色授予對應權限)。
   */
  perFormCreate?: boolean;
  /**
   * `modules.settings` 的**初始值**(不宣告 = `{}`)。與 `enabled`、`icon` 同屬「初始 seed 值的欄位」(ADR-0002):
   * 建立時寫入,之後保留人在畫面上的修改(如表單模組的列表欄位配置 `settings.list`)。
   */
  settings?: Record<string, unknown>;
}

/**
 * 專案對某個模組三個初始值欄位的指定(`seeds/project/settings.ts` 的 `moduleInitialValues`):
 * 只收 `enabled`、`icon`、`settings`,其餘欄位由宣告決定。已存在的畫面值仍優先 —— 這只影響首次建立與完整重建。
 */
export interface ModuleInitialValue {
  enabled?: boolean;
  /** `null` = 不要圖示(側欄用預設圖示)。 */
  icon?: ModuleIconKey | null;
  settings?: Record<string, unknown>;
}

/** 模組 key → 初始值指定;key 必須是已宣告的模組。 */
export type ModuleInitialValues = Readonly<Record<string, ModuleInitialValue>>;

/** 一筆個別權限;key 須為 `<moduleKey>.<動作>`(規約由 seed-key-convention 靜態測試強制)。 */
export interface PermissionDeclaration {
  key: string;
  /** 擁有模組(綁「它作為按鈕/欄位/跳窗/flag 所在的那一頁」,ADR-0004)。 */
  moduleKey: string;
  name: string;
  description?: string;
}

/**
 * 資料範圍目標(ADR-0008):落庫至 data_scope_targets,以 `(collection, moduleKey)` 為識別鍵。
 * `moduleKey` 不在宣告裡寫 —— seed runner 填宣告檔所在模組(第一個**非群組**節點的 key,
 * `seeds/base/modules.ts` 的 `ownerModuleKeyOf`),
 * 所以一個模組至多一個目標,同一張表(如 `form_submissions`)可以被多個模組各宣告一次。
 */
export interface DataScopeTargetDeclaration {
  collection: string;
  name: string;
  description?: string;
  /** 可篩業務欄位目錄;基礎欄位由程式自動附加,不入庫。 */
  fields: Record<string, unknown>[];
}

export interface ModuleSeedDeclaration {
  /** 依樹的先後宣告(父在前);跨檔、跨來源的父節點由組裝時依整棵樹排序。 */
  nodes: ModuleNodeDeclaration[];
  /** 個別權限;每個節點的 wildcard `<key>.*` 由 seeds/base/modules.ts 自動產生,不在此宣告。 */
  permissions?: PermissionDeclaration[];
  dataScopeTarget?: DataScopeTargetDeclaration;
}

/** 權限 key 的最後一段;wildcard 動作 `*` 代表該模組自己這一層的全部權限(ADR-0004,2026-09-17 定案「同層」語意)。 */
export const WILDCARD_ACTION = "*";

/** `<moduleKey>.<action>`。 */
export function permissionKey(moduleKey: string, action: string): string {
  return `${moduleKey}.${action}`;
}

/** 模組的 wildcard 權限(每個模組恰一筆;role_permission 只存這一筆)。 */
export function wildcardPermission(
  node: ModuleNodeDeclaration,
): PermissionDeclaration {
  return {
    key: permissionKey(node.key, WILDCARD_ACTION),
    moduleKey: node.key,
    name: "全部",
    description: `${node.name} 這一層的全部權限(含未來新增)`,
  };
}
