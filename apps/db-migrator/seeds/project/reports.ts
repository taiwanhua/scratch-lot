import {
  type ModuleSeedDeclaration,
  permissionKey,
} from "../base/module-declaration";

/**
 * 輸出報表(規格 3.1、3.2、第 11 章、18.4;正本 `docs/modules/project/reports.md`)。
 * 一次宣告整個模組的全部權限,之後登記報表的票只寫程式、不改這份宣告。
 *
 * - 一頁:選報表 → 條件 → [預覽] [匯出 Excel];進不進得去看模組本身(`me.modules`)
 * - 每張報表一條頁內權限 `reports.<報表 key>`,沒有的報表不出現在選單;另有 `export`、`show-cost`
 * - S2 升格(18.2):這份宣告整檔移到底座,模組 / 權限的 seed 所有權轉移(底座以新增的 seed 接手同一組 key)
 */
export const REPORTS_MODULE_KEY = "reports";

export const reportsModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: REPORTS_MODULE_KEY,
      name: "輸出報表",
      sidebarType: "link",
      parentKey: null,
      order: 14,
      route: "reports",
      icon: "chart",
      description: "選報表、設定期間與分店,預覽或匯出 Excel",
    },
  ],
  permissions: [
    {
      key: permissionKey(REPORTS_MODULE_KEY, "operations"),
      moduleKey: REPORTS_MODULE_KEY,
      name: "營運報表",
      description: "報表選單出現「營運報表」,可預覽",
    },
    {
      key: permissionKey(REPORTS_MODULE_KEY, "shift-checkouts"),
      moduleKey: REPORTS_MODULE_KEY,
      name: "班次結帳歷史報表",
      description: "報表選單出現「班次結帳歷史報表」,可預覽",
    },
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
