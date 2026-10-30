import {
  type ModuleSeedDeclaration,
  permissionKey,
} from "../base/module-declaration";
import { REPORTS_MODULE_KEY } from "../base/modules/reports";

/**
 * 專案登記的報表(規格 3.2、第 11 章;正本 `docs/modules/project/reports.md`)。
 * 「輸出報表」模組與模組層權限(`reports.export`、`reports.show-cost`)是底座的
 * (`seeds/base/modules/reports.ts`);這裡只宣告專案每張報表的頁內權限 `reports.<報表 key>`,
 * 與 admin `app/project/reports.ts` 的登記一一對應。
 */
export const reportsModule: ModuleSeedDeclaration = {
  nodes: [],
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
  ],
};
