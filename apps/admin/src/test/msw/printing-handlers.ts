import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  type CreatePrintAgentMutationVariables,
  type CreatePrinterMutationVariables,
  type PrintAgentDownloadUrlQueryVariables,
  type PrintAgentFieldsFragment,
  type PrintAgentReleaseQuery,
  type PrintAgentsQueryVariables,
  PrintJobError,
  type PrintJobFieldsFragment,
  type PrintJobQueryVariables,
  PrintJobStatus,
  type PrintJobsQueryVariables,
  type PrintPrinterTestPageMutationVariables,
  type PrinterFieldsFragment,
  type PrintersQueryVariables,
  type ResetPrintAgentPairingMutationVariables,
  type SetPrinterEnabledMutationVariables,
  type UpdatePrinterMutationVariables,
} from "@repo/graphql";

import {
  defaultAgents,
  defaultPrintJobs,
  defaultPrinters,
  defaultRelease,
  printJobFragment,
} from "./printing-fixtures";
import { api } from "./server";

/** 測試列印最後的結果:已印出,或失敗原因。 */
export type TestPrintResult = "printed" | PrintJobError;

export interface PrintingWorldOptions {
  agents?: PrintAgentFieldsFragment[];
  printers?: PrinterFieldsFragment[];
  jobs?: PrintJobFieldsFragment[];
  release?: PrintAgentReleaseQuery["printAgentRelease"];
  /** `printPrinterTestPage` 之後查 `printJob` 拿到的結果;`AGENT_OFFLINE` 照 api 在建立時就回失敗 */
  testPrintResult?: TestPrintResult;
  /** 這些操作一律回該錯誤碼 */
  failures?: Partial<Record<string, PrintingErrorCode>>;
}

type PrintingErrorCode =
  "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT";

/** GQL-04:HTTP 200 + `errors[].extensions.code`。 */
const printingError = (
  code: PrintingErrorCode,
  extensions: Record<string, unknown> = {},
) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [{ message: code, extensions: { ...extensions, code } }],
  });

const pageOf = <T>(items: T[], page = 1, pageSize = 20) => ({
  items: items.slice((page - 1) * pageSize, page * pageSize),
  totalCount: items.length,
  page,
  pageSize,
});

/** 配對碼(夾具值;8 碼、字元集同 `PRINT_PAIRING_CODE_ALPHABET`)。 */
export const TEST_PAIRING_CODE = "8K3MQ7PZ";
const PAIRING_EXPIRES_AT = "2026-10-16T14:11:00.000Z";

/**
 * 印表機管理的假 api(有狀態:新增 / 編輯 / 停用之後重查看得到新值)。`inputs` 記下每次呼叫的輸入,
 * 測試以它驗「送了什麼」。`OrgTree` 不在這裡:組織樹的正本是 `orgWorld`(mock 模式去重規則)。
 */
export const printingWorld = (options: PrintingWorldOptions = {}) => {
  const agents = [...(options.agents ?? defaultAgents())];
  const printers = [...(options.printers ?? defaultPrinters())];
  const jobs = [...(options.jobs ?? defaultPrintJobs())];
  const release = options.release ?? defaultRelease();
  const testPrintResult = options.testPrintResult ?? "printed";
  const failures = options.failures ?? {};
  let sequence = 0;
  const inputs = {
    agents: [] as PrintAgentsQueryVariables["input"][],
    createAgent: [] as CreatePrintAgentMutationVariables["input"][],
    resetPairing: [] as string[],
    disableAgent: [] as string[],
    download: [] as PrintAgentDownloadUrlQueryVariables["input"][],
    printers: [] as PrintersQueryVariables["input"][],
    createPrinter: [] as CreatePrinterMutationVariables["input"][],
    updatePrinter: [] as UpdatePrinterMutationVariables["input"][],
    setPrinterEnabled: [] as SetPrinterEnabledMutationVariables["input"][],
    testPrint: [] as PrintPrinterTestPageMutationVariables["input"][],
    jobs: [] as PrintJobsQueryVariables["input"][],
    /** `printJob(id)` 被查的 id(驗「即時通道連著時等信號才查」) */
    printJob: [] as string[],
    release: 0,
  };

  const failed = (operation: string) => {
    const code = failures[operation];
    return code === undefined ? null : printingError(code);
  };

  const finalJob = (job: PrintJobFieldsFragment): PrintJobFieldsFragment =>
    testPrintResult === "printed"
      ? { ...job, status: PrintJobStatus.Printed }
      : { ...job, status: PrintJobStatus.Failed, error: testPrintResult };

  const handlers = [
    api.query("PrintAgents", ({ variables }) => {
      const { input } = variables as PrintAgentsQueryVariables;
      inputs.agents.push(input);
      const items = agents.filter(
        (agent) =>
          (input.includeDisabled === true || agent.enabled) &&
          (input.orgId == null || agent.orgId === input.orgId),
      );
      return HttpResponse.json({
        data: {
          printAgents: pageOf(items, input.page ?? 1, input.pageSize ?? 20),
        },
      });
    }),
    api.mutation("CreatePrintAgent", ({ variables }) => {
      const { input } = variables as CreatePrintAgentMutationVariables;
      inputs.createAgent.push(input);
      const failure = failed("CreatePrintAgent");
      if (failure !== null) return failure;
      sequence += 1;
      const agent: PrintAgentFieldsFragment = {
        id: `agent-new-${String(sequence)}`,
        orgId: input.orgId,
        name: input.name,
        paired: false,
        pairingExpiresAt: PAIRING_EXPIRES_AT,
        online: false,
        lastSeenAt: null,
        version: null,
        updateAvailable: false,
        enabled: true,
        createdAt: PAIRING_EXPIRES_AT,
      };
      agents.push(agent);
      return HttpResponse.json({
        data: {
          createPrintAgent: {
            agent,
            pairingCode: TEST_PAIRING_CODE,
            pairingExpiresAt: PAIRING_EXPIRES_AT,
          },
        },
      });
    }),
    api.mutation("ResetPrintAgentPairing", ({ variables }) => {
      const { input } = variables as ResetPrintAgentPairingMutationVariables;
      inputs.resetPairing.push(input.id);
      const index = agents.findIndex((agent) => agent.id === input.id);
      if (index === -1) return printingError("NOT_FOUND");
      if (!agents[index].enabled) {
        return printingError("CONFLICT", { reason: "AGENT_DISABLED" });
      }
      agents[index] = {
        ...agents[index],
        paired: false,
        online: false,
        pairingExpiresAt: PAIRING_EXPIRES_AT,
      };
      return HttpResponse.json({
        data: {
          resetPrintAgentPairing: {
            agent: agents[index],
            pairingCode: TEST_PAIRING_CODE,
            pairingExpiresAt: PAIRING_EXPIRES_AT,
          },
        },
      });
    }),
    api.mutation("DisablePrintAgent", ({ variables }) => {
      const { input } = variables as { input: { id: string } };
      inputs.disableAgent.push(input.id);
      const index = agents.findIndex((agent) => agent.id === input.id);
      if (index === -1) return printingError("NOT_FOUND");
      agents[index] = {
        ...agents[index],
        enabled: false,
        paired: false,
        online: false,
      };
      return HttpResponse.json({
        data: { disablePrintAgent: { agent: agents[index] } },
      });
    }),
    api.query("PrintAgentRelease", () => {
      inputs.release += 1;
      return (
        failed("PrintAgentRelease") ??
        HttpResponse.json({ data: { printAgentRelease: release } })
      );
    }),
    api.query("PrintAgentDownloadUrl", ({ variables }) => {
      const { input } = variables as PrintAgentDownloadUrlQueryVariables;
      inputs.download.push(input);
      const failure = failed("PrintAgentDownloadUrl");
      if (failure !== null) return failure;
      const file = release.files.find(
        (item) => item.platform === input.platform,
      );
      if (file === undefined || release.latestVersion == null) {
        return printingError("NOT_FOUND");
      }
      return HttpResponse.json({
        data: {
          printAgentDownloadUrl: {
            url: `https://storage.example.test/print-agent/${release.latestVersion}/${file.name}?signature=1`,
            version: release.latestVersion,
            expiresAt: PAIRING_EXPIRES_AT,
            file,
          },
        },
      });
    }),
    api.query("Printers", ({ variables }) => {
      const { input } = variables as PrintersQueryVariables;
      inputs.printers.push(input);
      const items = printers.filter(
        (printer) =>
          (input.orgId == null || printer.orgId === input.orgId) &&
          (input.agentId == null || printer.agentId === input.agentId) &&
          (input.enabled == null || printer.enabled === input.enabled),
      );
      return HttpResponse.json({
        data: {
          printers: pageOf(items, input.page ?? 1, input.pageSize ?? 20),
        },
      });
    }),
    api.mutation("CreatePrinter", ({ variables }) => {
      const { input } = variables as CreatePrinterMutationVariables;
      inputs.createPrinter.push(input);
      const failure = failed("CreatePrinter");
      if (failure !== null) return failure;
      const agent = agents.find((item) => item.id === input.agentId);
      if (!agent?.enabled) {
        return printingError("VALIDATION_FAILED", { fields: ["agentId"] });
      }
      sequence += 1;
      const printer: PrinterFieldsFragment = {
        id: `printer-new-${String(sequence)}`,
        orgId: agent.orgId,
        agentId: agent.id,
        name: input.name,
        host: input.host,
        port: input.port ?? 9100,
        paperWidth: input.paperWidth ?? 58,
        isDefault: input.isDefault ?? false,
        enabled: true,
        status: null,
        statusAt: null,
        agentOnline: agent.online,
        available: true,
      };
      printers.push(printer);
      return HttpResponse.json({ data: { createPrinter: { printer } } });
    }),
    api.mutation("UpdatePrinter", ({ variables }) => {
      const { input } = variables as UpdatePrinterMutationVariables;
      inputs.updatePrinter.push(input);
      const failure = failed("UpdatePrinter");
      if (failure !== null) return failure;
      const index = printers.findIndex((printer) => printer.id === input.id);
      if (index === -1) return printingError("NOT_FOUND");
      const current = printers[index];
      printers[index] = {
        ...current,
        agentId: input.agentId ?? current.agentId,
        name: input.name ?? current.name,
        host: input.host ?? current.host,
        port: input.port ?? current.port,
        isDefault: input.isDefault ?? current.isDefault,
      };
      return HttpResponse.json({
        data: { updatePrinter: { printer: printers[index] } },
      });
    }),
    api.mutation("SetPrinterEnabled", ({ variables }) => {
      const { input } = variables as SetPrinterEnabledMutationVariables;
      inputs.setPrinterEnabled.push(input);
      const index = printers.findIndex((printer) => printer.id === input.id);
      if (index === -1) return printingError("NOT_FOUND");
      printers[index] = {
        ...printers[index],
        enabled: input.enabled,
        available: input.enabled,
      };
      return HttpResponse.json({
        data: { setPrinterEnabled: { printer: printers[index] } },
      });
    }),
    api.mutation("PrintPrinterTestPage", ({ variables }) => {
      const { input } = variables as PrintPrinterTestPageMutationVariables;
      inputs.testPrint.push(input);
      const failure = failed("PrintPrinterTestPage");
      if (failure !== null) return failure;
      const printer = printers.find((item) => item.id === input.printerId);
      if (printer === undefined) return printingError("NOT_FOUND");
      sequence += 1;
      const isOffline = testPrintResult === PrintJobError.AgentOffline;
      const job = printJobFragment({
        id: `job-test-${String(sequence)}`,
        orgId: printer.orgId,
        printerId: printer.id,
        documentType: "printer-test-page",
        refType: "printer",
        refId: printer.id,
        documentName: null,
        // api:送出時代理程式已離線 → 仍建立工作,但直接標失敗
        status: isOffline ? PrintJobStatus.Failed : PrintJobStatus.Pending,
        error: isOffline ? PrintJobError.AgentOffline : null,
        sentAt: null,
        printedAt: null,
      });
      jobs.unshift(job);
      return HttpResponse.json({ data: { printPrinterTestPage: { job } } });
    }),
    api.query("PrintJob", ({ variables }) => {
      const { id } = variables as PrintJobQueryVariables;
      inputs.printJob.push(id);
      const index = jobs.findIndex((job) => job.id === id);
      if (index === -1) return printingError("NOT_FOUND");
      // 假代理程式:第一次查就有結果
      if (jobs[index].status === PrintJobStatus.Pending) {
        jobs[index] = finalJob(jobs[index]);
      }
      return HttpResponse.json({ data: { printJob: { job: jobs[index] } } });
    }),
    api.query("PrintJobs", ({ variables }) => {
      const { input } = variables as PrintJobsQueryVariables;
      inputs.jobs.push(input);
      const items = jobs.filter(
        (job) =>
          (input.printerId == null || job.printerId === input.printerId) &&
          (input.status == null || job.status === input.status),
      );
      return HttpResponse.json({
        data: {
          printJobs: pageOf(items, input.page ?? 1, input.pageSize ?? 20),
        },
      });
    }),
  ];

  return { handlers, inputs, agents, printers, jobs };
};

export type PrintingWorld = ReturnType<typeof printingWorld>;
