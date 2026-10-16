import {
  PRINT_IMAGE_WIDTH_DOTS,
  type PrintAgentJob,
  type PrintAgentPrinter,
  type PrintAgentResultRequest,
  type PrinterStatus,
} from "@repo/domain/printing";

import type { AgentApi } from "../api-client/api-client";
import { buildPrintCommands } from "../escpos/commands";
import { decodePng, toMonoBitmap } from "../escpos/png";
import type { PrintOutcome, PrinterTransport } from "../escpos/transport";
import type { Logger } from "../logging/logger";
import { type Timers, sleep, systemTimers } from "../timers";

/**
 * 佇列(底座規格第 6 章 `job-runner`):**同一台印表機一次一張、依序印**;不同印表機互不等待。
 * 進來的工作都已經認領成功(等待中 → 已送出),這裡只負責:拿圖片 → ESC/POS → 送出 → 回報結果。
 * 心跳前查印表機狀態也排進同一條佇列,不會在列印中途插進另一條連線。
 */
export const RESULT_REPORT_ATTEMPTS = 3;
export const RESULT_RETRY_DELAY_MS = 2000;

export interface JobRunnerOptions {
  api: AgentApi;
  transport: PrinterTransport;
  logger: Logger;
  timers?: Timers;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class JobRunner {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly statuses = new Map<string, PrinterStatus>();
  private readonly timers: Timers;

  constructor(private readonly options: JobRunnerOptions) {
    this.timers = options.timers ?? systemTimers;
  }

  /** 已認領的工作排進該印表機的佇列;回傳這張印完(含回報)時完成的 promise。 */
  enqueue(printer: PrintAgentPrinter, job: PrintAgentJob): Promise<void> {
    return this.chain(printer.id, () => this.run(printer, job));
  }

  /** 查一台印表機的狀態(排在列印後面,不搶連線)。 */
  probe(printer: PrintAgentPrinter): Promise<PrinterStatus> {
    let status: PrinterStatus = this.statuses.get(printer.id) ?? "ok";
    return this.chain(printer.id, async () => {
      status = await this.options.transport.status(printer);
      this.statuses.set(printer.id, status);
    }).then(() => status);
  }

  /** 所有佇列都跑完(停止服務時等它)。 */
  async idle(): Promise<void> {
    while (this.queues.size > 0) {
      await Promise.all(this.queues.values());
    }
  }

  private chain(printerId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(printerId) ?? Promise.resolve();
    const next = previous.then(task).catch((error: unknown) => {
      this.options.logger.error("佇列工作失敗", {
        printerId,
        error: errorText(error),
      });
    });
    this.queues.set(printerId, next);
    void next.finally(() => {
      if (this.queues.get(printerId) === next) {
        this.queues.delete(printerId);
      }
    });
    return next;
  }

  private async run(
    printer: PrintAgentPrinter,
    job: PrintAgentJob,
  ): Promise<void> {
    const { logger } = this.options;
    const outcome = await this.print(printer, job);
    if (outcome.ok) {
      this.statuses.set(printer.id, "ok");
      logger.info("已印出", { jobId: job.id, printerId: printer.id });
      await this.report(job.id, { status: "printed" });
      return;
    }
    if (outcome.error === "paper-out") {
      this.statuses.set(printer.id, "paper-out");
    } else if (outcome.error === "printer-offline") {
      this.statuses.set(printer.id, "offline");
    }
    logger.warn("列印失敗", {
      jobId: job.id,
      printerId: printer.id,
      error: outcome.error,
      detail: outcome.detail,
    });
    await this.report(job.id, { status: "failed", error: outcome.error });
  }

  private async print(
    printer: PrintAgentPrinter,
    job: PrintAgentJob,
  ): Promise<PrintOutcome> {
    let image: Uint8Array;
    try {
      image = await this.options.api.image(job.id);
    } catch (error) {
      return {
        ok: false,
        error: "other",
        detail: `拿不到圖片:${errorText(error)}`,
      };
    }
    let chunks: Uint8Array[];
    try {
      const maxWidth = PRINT_IMAGE_WIDTH_DOTS[printer.paperWidth];
      chunks = buildPrintCommands(toMonoBitmap(decodePng(image), maxWidth));
    } catch (error) {
      return { ok: false, error: "other", detail: errorText(error) };
    }
    return this.options.transport.print(printer, chunks);
  }

  /** 回報結果;網路錯誤重試幾次(仍失敗時 API 會在 2 分鐘後標「未收到列印結果」)。 */
  private async report(
    jobId: string,
    body: PrintAgentResultRequest,
  ): Promise<void> {
    for (let attempt = 1; attempt <= RESULT_REPORT_ATTEMPTS; attempt += 1) {
      try {
        const accepted = await this.options.api.result(jobId, body);
        if (!accepted) {
          this.options.logger.warn(
            "回報被拒:工作已不是「已送出」(可能已逾時)",
            { jobId },
          );
        }
        return;
      } catch (error) {
        this.options.logger.warn("回報結果失敗", {
          jobId,
          attempt,
          error: errorText(error),
        });
        if (attempt < RESULT_REPORT_ATTEMPTS) {
          await sleep(this.timers, RESULT_RETRY_DELAY_MS);
        }
      }
    }
  }
}
