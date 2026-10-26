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
 * 已印次數照 api 以 `refType` + `refId` 計(= 一開始的 `printedCount` + 這張單據已印的工作數),
 * `printOnRead` 時工作第一次被查(`printJob`)就當作已印出;代理程式離線的印表機建立即失敗(`AGENT_OFFLINE`),同 api。
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
  /** 每張單據(每個 `refType` + `refId`)一開始已印的次數;預設 0(頁面測試以實際送出、印出的工作計,不寫死) */
  printedCount?: number;
  /** 工作第一次被查(`printJob`)時就印好了(模擬代理程式很快印完;不必逐張 `finish()`) */
  printOnRead?: boolean;
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
  /** 這張單據(`refType` + `refId`)現在的已印次數 */
  printedCountOf: (refType: string, refId: string) => number;
  /** 模擬代理程式回報(或 api 逾時標失敗):改工作狀態;已印時那張單據的已印次數 +1 */
  finish: (
    jobId: string,
    status: PrintJobStatus,
    error?: PrintJobError | null,
  ) => void;
  /** 別處送的同一張單據印好了(例:交易後的自動列印):已印次數 +1,不經過這顆按鈕 */
  printElsewhere: () => void;
}

export const printButtonWorld = ({
  printers = [printerFixture()],
  defaultPrinterId = printers.find((printer) => printer.isDefault)?.id ?? null,
  printedCount: initialCount = 0,
  printOnRead = false,
  reasons = reprintReasonFixtures,
  failPrintCount = false,
  createResponseGate,
}: PrintButtonWorldOptions = {}): PrintButtonWorld => {
  let elsewhere = 0;
  let reads = 0;
  let printerReads = 0;
  const jobs = new Map<string, PrintJobFieldsFragment>();
  const created: CreatePrintJobMutationVariables["input"][] = [];
  const printedCountOf = (refType: string, refId: string) =>
    initialCount +
    elsewhere +
    [...jobs.values()].filter(
      (job) =>
        job.status === PrintJobStatus.Printed &&
        job.refType === refType &&
        job.refId === refId,
    ).length;

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
    api.query<
      Record<string, unknown>,
      { input: { refType: string; refId: string } }
    >("DocumentPrintCount", ({ variables }) =>
      failPrintCount
        ? HttpResponse.json({
            data: null,
            errors: [{ message: "boom", extensions: { code: "UNEXPECTED" } }],
          })
        : HttpResponse.json({
            data: {
              documentPrintCount: {
                printedCount: printedCountOf(
                  variables.input.refType,
                  variables.input.refId,
                ),
              },
            },
          }),
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
          printNo: printedCountOf(input.refType, input.refId) + 1,
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
        const found = jobs.get(variables.id);
        const job =
          printOnRead && found?.status === PrintJobStatus.Pending
            ? { ...found, status: PrintJobStatus.Printed }
            : found;
        if (job !== undefined) {
          jobs.set(variables.id, job);
        }
        return HttpResponse.json({ data: { printJob: { job } } });
      },
    ),
  ];

  return {
    handlers,
    created,
    jobReads: () => reads,
    printerReads: () => printerReads,
    printedCountOf,
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
    },
    printElsewhere: () => {
      elsewhere += 1;
    },
  };
};
