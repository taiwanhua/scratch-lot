import type { ModuleSeedDeclaration } from "../module-declaration";

export const OVERVIEW_MODULE_KEY = "overview";

/**
 * 總覽(正本:docs/modules/overview.md):登入後的第一頁,頂層 link 模組、排在「系統管理」之前。
 * 進權限體系的理由(2026-09-18 定案):各租戶要看的總覽內容不同,必須能授權 / 收回。
 * 目前只有每模組固定的 `overview.*`(seeds/base/modules.ts 自動產生),個別權限待總覽內容定案後再種。
 */
export const overviewModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: OVERVIEW_MODULE_KEY,
      name: "總覽",
      sidebarType: "link",
      parentKey: null,
      order: 0,
      route: "overview",
      icon: "dashboard",
      description: "登入後的第一頁;側欄第一列",
    },
  ],
};
