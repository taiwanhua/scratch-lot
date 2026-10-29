// 專案的兩份來源刻意用 `@/` 別名而不是相對路徑:測試專案(`jest.config.mjs` 的 `project-fixture`)
// 以 `moduleNameMapper` 只換掉這兩支,其餘組裝、路由、守門、殼都是真的
import type { ComponentType } from "react";

import { projectModulePages } from "@/app/project/module-pages";
import { projectPageReplacements } from "@/app/project/page-replacements";
import { projectRealtimeSignals } from "@/app/project/realtime-signals";
import { projectReports } from "@/app/project/reports";
import { projectShellExtensions } from "@/app/project/shell-extensions";
import { projectUrlStateInventory } from "@/app/project/url-state-inventory";
import { projectWorkflowExtensions } from "@/app/project/workflow-extensions";
import type { WorkflowExtensionRegistration } from "@/hooks/base/useWorkflowExtensions";
import { composeRealtimeSignals } from "@/lib/base/realtime/signal-registry";
import { composeReports } from "@/lib/base/reports/report-registry";

import { baseModulePages } from "./base/module-pages";
import { baseRealtimeSignals } from "./base/realtime-signals";
import { baseReports } from "./base/reports";
import { baseShellExtensions } from "./base/shell-extensions";
import { baseWorkflowExtensions } from "./base/workflow-extensions";
import { composeModulePages } from "./module-page-registry";

/**
 * 模組頁面的固定組裝入口(組裝層,STRUCT-03):底座來源(`app/base/module-pages.ts`)+ 專案來源
 * (`app/project/module-pages.ts`)+ 專案對底座頁的替換(`app/project/page-replacements.ts`)→ 一張登記表。
 * 只有這支同時看得到底座與專案;登記有碰撞(重複 key、未知的替換目標…)時載入就丟錯,不會悄悄蓋掉。
 *
 * 新增或替換頁面不改這支:底座模組改 `app/base/`,專案改 `app/project/`。
 */
const composed = composeModulePages({
  base: baseModulePages,
  project: projectModulePages,
  replacements: projectPageReplacements,
});

/**
 * 模組 key → 頁面元件;沒登記的模組由殼顯示佔位頁(模組名)。
 * 路由本身仍由 `me.modules` 決定,這裡只決定「進去看到什麼」。
 */
export const modulePages = composed.pages;

/** 模組 key → 內容區最小寬度的主題斷點(沒列 = 殼層預設 `md`;`AdminShell/shell-geometry.ts`)。 */
export const modulePageMinWidths = composed.pageMinWidths;

/** 模組 key → 表單模組的模組層設定;由 `providers/RootProviders.tsx` 注入給表單頁。 */
export const formModuleOptions = composed.formModuleOptions;

/**
 * 即時通道的信號類型登記表:底座(`app/base/realtime-signals.ts`)+ 專案(`app/project/realtime-signals.ts`);
 * 同一類型重複登記載入就丟錯。由 `AdminShell` 交給 `RealtimeProvider`。
 */
export const realtimeSignals = composeRealtimeSignals(
  baseRealtimeSignals,
  projectRealtimeSignals,
);

/**
 * 輸出報表的登記清單(`docs/modules/reports.md`「報表登記介面」):底座(`app/base/reports.ts`)在前
 * + 專案(`app/project/reports.ts`);同一個報表 key 登記兩次載入就丟錯。由 `providers/RootProviders.tsx` 注入。
 */
export const reportRegistrations = composeReports(baseReports, projectReports);

/**
 * 依模組登記的審核擴充(`docs/modules/workflows.md`「依模組登記的審核擴充」):底座(`app/base/workflow-extensions.ts`)
 * + 專案(`app/project/workflow-extensions.ts`)。由 `AdminShell` 交給 `WorkflowExtensionsProvider`。
 */
export const workflowExtensions: readonly WorkflowExtensionRegistration[] = [
  ...baseWorkflowExtensions,
  ...projectWorkflowExtensions,
];

/**
 * 殼上的常駐元件(`docs/concepts/frontend-architecture.md`「殼上的常駐元件」):底座(`app/base/shell-extensions.ts`)
 * + 專案(`app/project/shell-extensions.ts`)。由 `AdminShell` 在殼層渲染。
 */
export const shellExtensions: readonly ComponentType[] = [
  ...baseShellExtensions,
  ...projectShellExtensions,
];

/**
 * 專案來源的網址狀態盤點(REACT-14 入口清單):專案的頁面登記 + 換掉的底座頁 + 專案的盤點表。
 * 只有這支看得到專案來源,入口清單測試從這裡拿,底座的盤點表另外比對底座來源。
 */
export const projectUrlStateCoverage = {
  source: projectModulePages,
  replacements: projectPageReplacements,
  inventory: projectUrlStateInventory,
};
