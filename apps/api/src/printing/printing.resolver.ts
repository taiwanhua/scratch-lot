import { Args, ID, Mutation, Query, Resolver } from "@nestjs/graphql";

import { CurrentOperator } from "../auth/decorators";
import type { OperatorContext } from "../database/operator-context";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  CreatePrintAgentInput,
  CreatePrintJobInput,
  CreatePrinterInput,
  DocumentPrintCountInput,
  PrintAgentDownloadUrlInput,
  PrintAgentIdInput,
  PrintAgentsInput,
  PrintJobsInput,
  PrintPrinterTestPageInput,
  PrintersInput,
  SetPrinterEnabledInput,
  UpdatePrinterInput,
} from "./dto/printing.input";
import {
  DocumentPrintCountPayload,
  PrintAgentDownloadUrlPayload,
  PrintAgentPairingPayload,
  PrintAgentPayload,
  type PrintAgentPlatformEnum,
  PrintAgentReleasePayload,
  PrintAgentsPayload,
  PrintJobPayload,
  PrintJobsPayload,
  PrintablePrintersPayload,
  PrinterPayload,
  PrintersPayload,
  ReprintReasonsPayload,
} from "./models/printing.model";
import { PrintAgentReleaseService } from "./print-agent-release.service";
import { PrintAgentsService } from "./print-agents.service";
import { PrintJobsService } from "./print-jobs.service";
import { PrintersService } from "./printers.service";

/**
 * 印表機管理與列印的 GraphQL 端點(docs/modules/printers.md「api 介面」「權限」)。
 * resolver 只做「守門 + 轉呼叫」(STRUCT-01);權限 key 與權限表同一行:
 * `system.printers.view` 看三個分頁、`create` 新增代理程式 / 印表機與下載安裝檔、
 * `edit` 編輯 / 停用 / 重新配對 / 測試列印;`api.printing.print` 列印(補印另要 `reprint`,由 service 判)。
 */
@Resolver()
export class PrintingResolver {
  constructor(
    private readonly agents: PrintAgentsService,
    private readonly printers: PrintersService,
    private readonly jobs: PrintJobsService,
    private readonly release: PrintAgentReleaseService,
  ) {}

  // ---- 代理程式 ----

  @RequirePermission("system.printers.view")
  @Query(() => PrintAgentsPayload, { name: "printAgents" })
  printAgents(
    @Args("input") input: PrintAgentsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintAgentsPayload> {
    return this.agents.list(operator, input);
  }

  @RequirePermission("system.printers.create")
  @Mutation(() => PrintAgentPairingPayload)
  createPrintAgent(
    @Args("input") input: CreatePrintAgentInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintAgentPairingPayload> {
    return this.agents.create(operator, input);
  }

  @RequirePermission("system.printers.edit")
  @Mutation(() => PrintAgentPairingPayload)
  resetPrintAgentPairing(
    @Args("input") input: PrintAgentIdInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintAgentPairingPayload> {
    return this.agents.resetPairing(operator, input.id);
  }

  @RequirePermission("system.printers.edit")
  @Mutation(() => PrintAgentPayload)
  async disablePrintAgent(
    @Args("input") input: PrintAgentIdInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintAgentPayload> {
    return { agent: await this.agents.disable(operator, input.id) };
  }

  // ---- 安裝檔下載 ----

  @RequirePermission("system.printers.create")
  @Query(() => PrintAgentReleasePayload, { name: "printAgentRelease" })
  async printAgentRelease(): Promise<PrintAgentReleasePayload> {
    const latest = await this.release.latest();
    return {
      latestVersion: latest?.version ?? null,
      files: (latest?.files ?? []).map((file) => ({
        ...file,
        platform: file.platform as PrintAgentPlatformEnum,
      })),
    };
  }

  @RequirePermission("system.printers.create")
  @Query(() => PrintAgentDownloadUrlPayload, { name: "printAgentDownloadUrl" })
  async printAgentDownloadUrl(
    @Args("input") input: PrintAgentDownloadUrlInput,
  ): Promise<PrintAgentDownloadUrlPayload> {
    const download = await this.release.downloadUrl(input.platform);
    return {
      ...download,
      file: {
        ...download.file,
        platform: download.file.platform as PrintAgentPlatformEnum,
      },
    };
  }

  // ---- 印表機 ----

  @RequirePermission("system.printers.view")
  @Query(() => PrintersPayload, { name: "printers" })
  printersList(
    @Args("input") input: PrintersInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintersPayload> {
    return this.printers.list(operator, input);
  }

  @RequirePermission("system.printers.create")
  @Mutation(() => PrinterPayload)
  async createPrinter(
    @Args("input") input: CreatePrinterInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrinterPayload> {
    return { printer: await this.printers.create(operator, input) };
  }

  @RequirePermission("system.printers.edit")
  @Mutation(() => PrinterPayload)
  async updatePrinter(
    @Args("input") input: UpdatePrinterInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrinterPayload> {
    return { printer: await this.printers.update(operator, input) };
  }

  @RequirePermission("system.printers.edit")
  @Mutation(() => PrinterPayload)
  async setPrinterEnabled(
    @Args("input") input: SetPrinterEnabledInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrinterPayload> {
    return { printer: await this.printers.setEnabled(operator, input) };
  }

  @RequirePermission("system.printers.edit")
  @Mutation(() => PrintJobPayload)
  async printPrinterTestPage(
    @Args("input") input: PrintPrinterTestPageInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintJobPayload> {
    await this.printers.assertExists(operator, input.printerId);
    return { job: await this.jobs.printTestPage(operator, input) };
  }

  // ---- 列印(各單據的列印按鈕)----

  @RequirePermission("api.printing.print")
  @Query(() => PrintablePrintersPayload, { name: "printablePrinters" })
  printablePrinters(
    @Args("orgId", { type: () => ID }) orgId: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintablePrintersPayload> {
    return this.printers.printable(operator, orgId);
  }

  @RequirePermission("api.printing.print")
  @Query(() => DocumentPrintCountPayload, { name: "documentPrintCount" })
  async documentPrintCount(
    @Args("input") input: DocumentPrintCountInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<DocumentPrintCountPayload> {
    return { printedCount: await this.jobs.printedCount(operator, input) };
  }

  /** 補印對話框的原因選項(有補印權限才需要選原因)。 */
  @RequirePermission("api.printing.reprint")
  @Query(() => ReprintReasonsPayload, { name: "reprintReasons" })
  async reprintReasons(
    @CurrentOperator() operator: OperatorContext,
  ): Promise<ReprintReasonsPayload> {
    return { items: await this.jobs.reprintReasons(operator) };
  }

  @RequirePermission("api.printing.print")
  @Mutation(() => PrintJobPayload)
  async createPrintJob(
    @Args("input") input: CreatePrintJobInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintJobPayload> {
    return { job: await this.jobs.createFromButton(operator, input) };
  }

  /** 單筆(收到 `print-result` 後查結果):要求人本人或持 `system.printers.view`。 */
  @Query(() => PrintJobPayload, { name: "printJob" })
  async printJob(
    @Args("id", { type: () => ID }) id: string,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintJobPayload> {
    return { job: await this.jobs.findOne(operator, id) };
  }

  @RequirePermission("system.printers.view")
  @Query(() => PrintJobsPayload, { name: "printJobs" })
  printJobs(
    @Args("input") input: PrintJobsInput,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<PrintJobsPayload> {
    return this.jobs.list(operator, input);
  }
}
