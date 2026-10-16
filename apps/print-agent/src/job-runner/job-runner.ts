import {
  PRINT_IMAGE_WIDTH_DOTS,
  PRINT_JOB_RESULT_TIMEOUT_MS,
  type PrintAgentJob,
  type PrintAgentPrinter,
  type PrintAgentResultRequest,
  type PrinterStatus,
} from "@repo/domain/printing";

import type { AgentApi } from "../api-client/api-client";
import { buildPrintCommands } from "../escpos/commands";
import { decodePrintImage } from "../escpos/png";
import type { PrintOutcome, PrinterTransport } from "../escpos/transport";
import type { Logger } from "../logging/logger";
import { type Timers, sleep, systemTimers } from "../timers";

/**
 * 佇列(底座規格第 6 章 `job-runner`):**同一台印表機一次一張、依序印**;不同印表機互不等待。
 * 進來的工作都已經認領成功(等待中 → 已送出),這裡只負責:拿圖片 → ESC/POS → 送出 → 回報結果。
 * 心跳查印表機狀態:佇列空著才排進去查(不在列印中途插進另一條連線);佇列忙就直接用上次的狀態,
 * 心跳不會被一張卡住的單據拖住。
 *
 * - 開印前若認領已超過 `PRINT_JOB_RESULT_TIMEOUT_MS`(API 已標「未收到列印結果」),不印,避免晚很久才吐單。
 * - 回報結果在佇列外進行(不擋下一張),網路錯誤依 `RESULT_RETRY_DELAYS_MS` 退避重試,總長約 90 秒;
 *   仍失敗時 API 會在 2 分鐘後標「未收到列印結果」。
 */
export const RESULT_RETRY_DELAYS_MS: readonly number[] = [
  2000, 4000, 8000, 16_000, 30_000, 30_000,
];

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
  private readonly reporting = new Set<Promise<void>>();
  private readonly timers: Timers;

  constructor(private readonly options: JobRunnerOptions) {
    this.timers = options.timers ?? systemTimers;
  }

  /**
   * 已認領的工作排進該印表機的佇列;回傳這張送完時完成的 promise(回報另外跑,`idle()` 會等)。
   * `claimedAt` = 認領成功的時刻(`timers.now()`)。
   */
  enqueue(
    printer: PrintAgentPrinter,
    job: PrintAgentJob,
    claimedAt: number,
  ): Promise<void> {
    return this.chain(printer.id, () => this.run(printer, job, claimedAt));
  }

  /** 查一台印表機的狀態(排在列印後面,不搶連線)。 */
  probe(printer: PrintAgentPrinter): Promise<PrinterStatus> {
    let status: PrinterStatus = this.statuses.get(printer.id) ?? "ok";
    if (this.queues.has(printer.id)) {
      // 正在印(或卡住):不等,用上次的狀態
      return Promise.resolve(status);
    }
    return this.chain(printer.id, async () => {
      status = await this.options.transport.status(printer);
      this.statuses.set(printer.id, status);
    }).then(() => status);
  }

  /** 所有佇列都跑完(停止服務時等它)。 */
  async idle(): Promise<void> {
    while (this.queues.size > 0 || this.reporting.size > 0) {
      await Promise.all([...this.queues.values(), ...this.reporting]);
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
    claimedAt: number,
  ): Promise<void> {
    const { logger } = this.options;
    if (this.timers.now() - claimedAt > PRINT_JOB_RESULT_TIMEOUT_MS) {
      logger.warn("認領已超過結果逾時,不印(API 已標「未收到列印結果」)", {
        jobId: job.id,
        printerId: printer.id,
      });
      return;
    }
    const outcome = await this.print(printer, job);
    if (outcome.ok) {
      this.statuses.set(printer.id, "ok");
      logger.info("已印出", { jobId: job.id, printerId: printer.id });
      this.reportLater(job.id, { status: "printed" });
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
    this.reportLater(job.id, { status: "failed", error: outcome.error });
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
      chunks = buildPrintCommands(decodePrintImage(image, maxWidth));
    } catch (error) {
      return { ok: false, error: "other", detail: errorText(error) };
    }
    return this.options.transport.print(printer, chunks);
  }

  private reportLater(jobId: string, body: PrintAgentResultRequest): void {
    const task = this.report(jobId, body);
    this.reporting.add(task);
    void task.finally(() => this.reporting.delete(task));
  }

  /** 回報結果;網路錯誤依退避重試。 */
  private async report(
    jobId: string,
    body: PrintAgentResultRequest,
  ): Promise<void> {
    const attempts = RESULT_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
        const delay = RESULT_RETRY_DELAYS_MS[attempt - 1];
        if (delay !== undefined) {
          await sleep(this.timers, delay);
        }
      }
    }
  }
}
