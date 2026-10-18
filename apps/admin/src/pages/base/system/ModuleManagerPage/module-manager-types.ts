import type { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

/**
 * `moduleTree` 的節點形狀(codegen 把遞迴展開成五層具名型別,無法直接遞迴走訪,
 * 這裡給一個結構相容的型別當走訪介面;`children` 在最深一層不存在,故為選填)。
 *
 * 這棵樹是**治理面的全樹**:含側欄看不到的 hidden 節點、隱藏的 api 權限樹,
 * 以及已停用的模組與權限 —— 與 `me.modules`(「我能用什麼」,吃 enabled 當過濾)
 * 是兩種相反的讀法,所以夾具也各有一份(`module-admin-fixtures.ts` / `module-fixtures.ts`)。
 */
export interface ModuleAdminNodeLike {
  id: string;
  key: string;
  name: string;
  parentId?: string | null;
  sidebarType: ModuleSidebarType;
  /**
   * 路由**只有自己那一段**(不是完整路徑);`null` = 不對應任何畫面。
   * `sidebarType = Hidden` 且 `route` 為 `null` ⇒ 權限容器(`isPermissionContainer`)。
   */
  route?: string | null;
  order: number;
  description?: string | null;
  /** 側欄圖示 key(白名單 `@repo/domain/module-icon`);`null` = 沒指定,側欄用預設圖示 */
  icon?: string | null;
  /** **這個節點自己的**停用狀態:停用連動子樹時子孫的值已一併落庫,不必回頭看祖先 */
  enabled: boolean;
  /** `FORM` = 表單模組(頁面由表單引擎組裝;右側多一列「列表欄位配置」) */
  engine?: ModuleEngine;
  permissions: readonly ModuleAdminPermissionLike[];
  children?: readonly ModuleAdminNodeLike[];
}

/** 一筆權限;`enabled=false` 是全域 kill switch(連超級管理員都不再持有,ADR-0011 步驟 4)。 */
export interface ModuleAdminPermissionLike {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  enabled: boolean;
}

/**
 * 本頁會分流的錯誤碼(正本 `docs/modules/module-manager.md`「api 介面」:
 * 沒有本模組專屬的新錯誤碼,只沿用這幾個)。
 */
export type ModuleManagerErrorCode = "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
