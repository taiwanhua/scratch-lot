import {
  ModuleEngine,
  ModuleSidebarType,
  type PrintAgentFieldsFragment,
  PrintAgentPlatform,
  type PrintAgentReleaseQuery,
  PrintJobError,
  type PrintJobFieldsFragment,
  PrintJobStatus,
  type PrinterFieldsFragment,
  PrinterStatus,
} from "@repo/graphql";

import type { TestModule } from "./auth-handlers";

/**
 * 印表機管理的夾具(形狀對齊 api 的 `apps/api/src/printing/printing-mapper.ts` 與 operation 文件
 * `packages/graphql/src/documents/base/printing.graphql` 的三個 fragment)。
 * 組織 id 對齊 `org-fixtures.ts` 的租戶樹(A-1 內容組、A-2 台北分店)。
 */

export const PRINTERS_ROUTE = "/system/printers";

/** 印表機管理的側欄節點(seed `system.ts`:系統管理群組第 10 項,圖示 `print`)。 */
export const printersModule = (
  permissions: readonly string[] = ["system.printers.*"],
): TestModule => ({
  id: "m-printers",
  key: "system.printers",
  name: "印表機管理",
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 10,
  route: PRINTERS_ROUTE,
  icon: "print",
  permissions: [...permissions],
});

const STAMP = "2026-10-16T14:01:00.000Z";

export const agentFragment = (
  overrides: Partial<PrintAgentFieldsFragment> = {},
): PrintAgentFieldsFragment => ({
  id: "agent-counter",
  orgId: "org-content",
  name: "櫃台電腦",
  paired: true,
  pairingExpiresAt: null,
  online: true,
  lastSeenAt: STAMP,
  version: "1.2.0",
  updateAvailable: false,
  enabled: true,
  createdAt: "2026-10-01T02:00:00.000Z",
  ...overrides,
});

export const printerFragment = (
  overrides: Partial<PrinterFieldsFragment> = {},
): PrinterFieldsFragment => ({
  id: "printer-counter",
  orgId: "org-content",
  agentId: "agent-counter",
  name: "櫃台收據機",
  host: "192.0.2.50",
  port: 9100,
  paperWidth: 58,
  isDefault: true,
  enabled: true,
  status: PrinterStatus.Ok,
  statusAt: STAMP,
  agentOnline: true,
  available: true,
  ...overrides,
});

export const printJobFragment = (
  overrides: Partial<PrintJobFieldsFragment> = {},
): PrintJobFieldsFragment => ({
  id: "job-1",
  orgId: "org-content",
  printerId: "printer-counter",
  documentType: "demo-document",
  refType: "demo-document",
  refId: "D-0031",
  documentName: "示範單據 #D-0031",
  status: PrintJobStatus.Printed,
  error: null,
  isReprint: false,
  printNo: 1,
  reprintReason: null,
  reprintNote: null,
  requestedBy: { id: "user-1", name: "示範使用者" },
  createdAt: STAMP,
  sentAt: STAMP,
  printedAt: STAMP,
  ...overrides,
});

/** 兩台代理程式:分店 A 已連線、分店 B 離線且舊版(「請更新」)。 */
export const defaultAgents = (): PrintAgentFieldsFragment[] => [
  agentFragment(),
  agentFragment({
    id: "agent-store",
    orgId: "org-store",
    name: "倉庫電腦",
    online: false,
    lastSeenAt: "2026-10-12T10:30:00.000Z",
    version: "1.1.0",
    updateAvailable: true,
  }),
];

/** 兩台印表機:櫃台(預設、正常)、倉庫(代理程式離線)。 */
export const defaultPrinters = (): PrinterFieldsFragment[] => [
  printerFragment(),
  printerFragment({
    id: "printer-store",
    orgId: "org-store",
    agentId: "agent-store",
    name: "倉庫收據機",
    host: "192.0.2.60",
    isDefault: false,
    status: PrinterStatus.Offline,
    agentOnline: false,
  }),
];

/** 三筆列印紀錄:已印出、補印第 2 次、失敗(代理程式離線)。 */
export const defaultPrintJobs = (): PrintJobFieldsFragment[] => [
  printJobFragment(),
  printJobFragment({
    id: "job-2",
    refId: "D-0030",
    documentName: "示範單據 #D-0030",
    isReprint: true,
    printNo: 2,
    reprintReason: "damaged",
    createdAt: "2026-10-16T13:58:00.000Z",
  }),
  printJobFragment({
    id: "job-3",
    printerId: "printer-store",
    orgId: "org-store",
    refId: "D-0029",
    documentName: "示範單據 #D-0029",
    status: PrintJobStatus.Failed,
    error: PrintJobError.AgentOffline,
    sentAt: null,
    printedAt: null,
    createdAt: "2026-10-16T13:40:00.000Z",
  }),
];

/** 已發布 1.2.0,四個平台都有。 */
export const defaultRelease =
  (): PrintAgentReleaseQuery["printAgentRelease"] => ({
    latestVersion: "1.2.0",
    files: [
      PrintAgentPlatform.WindowsX64,
      PrintAgentPlatform.LinuxX64,
      PrintAgentPlatform.LinuxArm64,
      PrintAgentPlatform.MacosArm64,
    ].map((platform) => ({
      platform,
      name: `print-agent-${platform.toLowerCase().replace("_", "-")}.zip`,
      sha256: "0".repeat(64),
      size: 150_000_000,
    })),
  });
