import {
  type ModuleSeedDeclaration,
  permissionKey,
} from "../module-declaration";

export const REPORTS_MODULE_KEY = "reports";

/**
 * 輸出報表(正本:docs/modules/reports.md):頂層 link 模組、固定頁。選報表 → 條件(期間、組織、其他條件)→
 * [預覽] [匯出 Excel];報表本身由底座 / 專案在 admin 登記(`registerReport`)。
 *
 * 這裡只宣告模組與模組層的頁內權限;每張報表各一條 `reports.<報表 key>`(沒有的報表不出現在選單),
 * 由登記那張報表的一方在自己的 seed 宣告(同一個 `moduleKey`,`composeModuleSeeds` 合併)。
 */
export const reportsModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: REPORTS_MODULE_KEY,
      name: "輸出報表",
      sidebarType: "link",
      parentKey: null,
      order: 50,
      route: "reports",
      icon: "chart",
      description: "選報表、設定期間與組織,預覽或匯出 Excel",
    },
  ],
  permissions: [
    {
      key: permissionKey(REPORTS_MODULE_KEY, "export"),
      moduleKey: REPORTS_MODULE_KEY,
      name: "匯出",
      description: "[匯出 Excel] 按鈕",
    },
    {
      key: permissionKey(REPORTS_MODULE_KEY, "show-cost"),
      moduleKey: REPORTS_MODULE_KEY,
      name: "成本與毛利",
      description: "報表的成本與毛利欄位(預覽與 Excel 都是)",
    },
  ],
};
