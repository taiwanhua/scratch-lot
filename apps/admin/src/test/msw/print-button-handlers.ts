import { HttpResponse } from "msw";

import {
  type CreatePrintJobMutationVariables,
  ModuleEngine,
  ModuleSidebarType,
  PrintJobError,
  type PrintJobFieldsFragment,
  PrintJobStatus,
  type PrinterFieldsFragment,
} from "@repo/graphql";

import type { TestModule } from "./auth-handlers";
import { api } from "./server";

/**
 * 列印按鈕的假伺服器(api 正本 `apps/api/src/printing/`;形狀照 `print-jobs.test.ts` 的斷言):
 * `printablePrinters`、`documentPrintCount`、`createPrintJob`、`printJob`、`reprintReasons`。
 * 有狀態:建立的工作記在 world 裡,測試用 `finish()` 模擬代理程式回報(已印才算進已印次數);
 * 代理程式離線的印表機建立即失敗(`AGENT_OFFLINE`),同 api。
 */

/** `api.printing` 權限容器(hidden 模組);`permissions` 決定能不能列印 / 補印。 */
export const printingModule = (permissions: string[]): TestModule => ({
  id: "m-api-printing",
  key: "api.printing",
  name: "列印",
  parentId: null,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order: 99,
  route: null,
  icon: null,
  permissions,
});

export const printerFixture = (
  overrides: Partial<PrinterFieldsFragment> = {},
): PrinterFieldsFragment => ({
  id: "printer-1",
  orgId: "store-a",
  agentId: "agent-1",
  name: "櫃台收據機",
  host: "receipt-a.lan",
  port: 9100,
  paperWidth: 58,
  isDefault: true,
  enabled: true,
  status: null,
  statusAt: null,
  agentOnline: true,
  available: true,
  ...overrides,
});

/** 底座 seed 的補印原因(`apps/db-migrator/seeds/base/fields.ts`)。 */
export const reprintReasonFixtures = [
  { value: "lost", label: "遺失" },
  { value: "damaged", label: "破損" },
  { value: "other", label: "其他" },
];

export interface PrintButtonWorldOptions {
  printers?: PrinterFieldsFragment[];
  defaultPrinterId?: string | null;
  /** 這張單據(不分 ref)一開始已印的次數 */
  printedCount?: number;
  /** 補印原因選項(預設底座 seed 的三個) */
  reasons?: { value: string; label: string }[];
  /** `documentPrintCount` 一律失敗 */
  failPrintCount?: boolean;
  /** 建立工作的回應等這個 promise 完成才回(模擬「信號比建立回應先到」);工作在收到請求時就已建立 */
  createResponseGate?: Promise<unknown>;
}

export interface PrintButtonWorld {
  handlers: ReturnType<typeof api.query>[];
  /** 收到的 `createPrintJob` input,依序 */
  created: CreatePrintJobMutationVariables["input"][];
  /** `printJob` 被查的次數 */
  jobReads: () => number;
  /** `printablePrinters` 被查的次數 */
  printerReads: () => number;
  /** 模擬代理程式回報(或 api 逾時標失敗):改工作狀態;已印時已印次數 +1 */
  finish: (
    jobId: string,
    status: PrintJobStatus,
    error?: PrintJobError | null,
  ) => void;
}

export const printButtonWorld = ({
  printers = [printerFixture()],
  defaultPrinterId = printers.find((printer) => printer.isDefault)?.id ?? null,
  printedCount: initialCount = 0,
  reasons = reprintReasonFixtures,
  failPrintCount = false,
  createResponseGate,
}: PrintButtonWorldOptions = {}): PrintButtonWorld => {
  let printedCount = initialCount;
  let reads = 0;
  let printerReads = 0;
  const jobs = new Map<string, PrintJobFieldsFragment>();
  const created: CreatePrintJobMutationVariables["input"][] = [];

  const handlers = [
    api.query("PrintablePrinters", () => {
      printerReads += 1;
      return HttpResponse.json({
        data: {
          printablePrinters: {
            items: printers,
            totalCount: printers.length,
            defaultPrinterId,
          },
        },
      });
    }),
    api.query("DocumentPrintCount", () =>
      failPrintCount
        ? HttpResponse.json({
            data: null,
            errors: [{ message: "boom", extensions: { code: "UNEXPECTED" } }],
          })
        : HttpResponse.json({ data: { documentPrintCount: { printedCount } } }),
    ),
    api.query("ReprintReasons", () =>
      HttpResponse.json({
        data: { reprintReasons: { items: reasons } },
      }),
    ),
    api.mutation<Record<string, unknown>, CreatePrintJobMutationVariables>(
      "CreatePrintJob",
      async ({ variables }) => {
        const { input } = variables;
        created.push(input);
        const printer = printers.find((item) => item.id === input.printerId);
        const isReprint = input.isReprint === true;
        const id = `job-${String(created.length)}`;
        const isOffline = printer?.agentOnline === false;
        const job: PrintJobFieldsFragment = {
          id,
          orgId: printer?.orgId ?? "store-a",
          printerId: input.printerId,
          documentType: input.documentType,
          refType: input.refType,
          refId: input.refId,
          documentName: input.documentName ?? null,
          status: isOffline ? PrintJobStatus.Failed : PrintJobStatus.Pending,
          error: isOffline ? PrintJobError.AgentOffline : null,
          isReprint,
          printNo: printedCount + 1,
          reprintReason: isReprint ? (input.reprintReason ?? null) : null,
          reprintNote: isReprint ? (input.reprintNote ?? null) : null,
          requestedBy: { id: "user-1", name: "小華" },
          createdAt: new Date().toISOString(),
          sentAt: null,
          printedAt: null,
        };
        jobs.set(id, job);
        await createResponseGate;
        return HttpResponse.json({ data: { createPrintJob: { job } } });
      },
    ),
    api.query<Record<string, unknown>, { id: string }>(
      "PrintJob",
      ({ variables }) => {
        reads += 1;
        const job = jobs.get(variables.id);
        return HttpResponse.json({ data: { printJob: { job } } });
      },
    ),
  ];

  return {
    handlers,
    created,
    jobReads: () => reads,
    printerReads: () => printerReads,
    finish: (jobId, status, error = null) => {
      const job = jobs.get(jobId);
      if (job === undefined) {
        throw new Error(`沒有這張工作:${jobId}`);
      }
      jobs.set(jobId, {
        ...job,
        status,
        error: status === PrintJobStatus.Failed ? error : null,
      });
      if (status === PrintJobStatus.Printed) {
        printedCount += 1;
      }
    },
  };
};
