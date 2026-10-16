import {
  PRINT_AGENT_HEARTBEAT_INTERVAL_MS,
  PRINT_AGENT_POLL_INTERVAL_MS,
  PRINT_SIGNALS,
  type PrintAgentJob,
  type PrintAgentPrinter,
  type PrinterStatus,
} from "@repo/domain/printing";
import type { RealtimeSignal } from "@repo/domain/realtime";

import { type AgentApi, PrintAgentApiError } from "../api-client/api-client";
import type { PrinterTransport } from "../escpos/transport";
import { JobRunner } from "../job-runner/job-runner";
import type { Logger } from "../logging/logger";
import {
  RealtimeLink,
  type RealtimeLinkOptions,
  type RealtimeLinkStatus,
} from "../realtime/realtime-link";
import { type Timers, systemTimers } from "../timers";

/**
 * 代理程式本體:把即時通道、輪詢、心跳與佇列接在一起(底座規格第 6 章「代理程式」)。
 *
 * | 時機                         | 做什麼                                                                  |
 * | ---------------------------- | ----------------------------------------------------------------------- |
 * | 啟動                         | 心跳一次 → 先拿一次未完成工作 → 連即時通道                              |
 * | 收到 `print-job` 信號        | 認領那張工作                                                            |
 * | 即時通道沒連上(`down`)     | 每 60 秒 `GET /print-agent/jobs`,逐張認領                             |
 * | 即時通道重新連上(`live`)   | 先補抓一次                                                              |
 * | 每 60 秒(不論有沒有連上)   | 心跳 `POST /print-agent/heartbeat`:版本 + 印表機狀態(維持 `lastSeenAt`) |
 *
 * **只印一次**:信號與輪詢可能同時帶來同一張工作。這裡先以「最近處理過的工作 id」擋掉本機的重複,
 * 真正的保證是 API 的認領(等待中 → 已送出 的條件更新,第二次 409):認領成功才印。
 */
export interface RealtimeLinkLike {
  start(): void;
  stop(): void;
}

export interface PrintAgentOptions {
  api: AgentApi;
  transport: PrinterTransport;
  logger: Logger;
  version: string;
  timers?: Timers;
  /** 建立即時通道連線(測試注入假的 socket;預設 `RealtimeLink` + Node 內建 WebSocket)。 */
  createRealtime?: (options: RealtimeLinkOptions) => RealtimeLinkLike;
}

/** 「處理過」的工作 id 留多久:比工作逾時(2 分鐘)長,過了 API 也不會再給。 */
export const HANDLED_JOB_TTL_MS = 10 * 60 * 1000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PrintAgent {
  private readonly timers: Timers;
  private readonly runner: JobRunner;
  private readonly realtime: RealtimeLinkLike;
  private readonly printers = new Map<string, PrintAgentPrinter>();
  private readonly handled = new Map<string, number>();
  /** 進行中的認領(`idle()` 等它們)。 */
  private readonly claiming = new Set<Promise<void>>();
  private status: RealtimeLinkStatus = "down";
  private pollTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private running = false;
  private unauthorized = false;

  constructor(private readonly options: PrintAgentOptions) {
    this.timers = options.timers ?? systemTimers;
    this.runner = new JobRunner({
      api: options.api,
      transport: options.transport,
      logger: options.logger,
      timers: this.timers,
    });
    const realtimeOptions: RealtimeLinkOptions = {
      fetchTicket: async () => {
        const grant = await options.api.ticket();
        return grant.ticket === null || grant.connectUrl === null
          ? null
          : { ticket: grant.ticket, connectUrl: grant.connectUrl };
      },
      onSignal: (signal) => {
        this.handleSignal(signal);
      },
      onStatus: (status) => {
        this.handleStatus(status);
      },
      logger: options.logger,
      timers: this.timers,
    };
    this.realtime =
      options.createRealtime?.(realtimeOptions) ??
      new RealtimeLink(realtimeOptions);
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.options.logger.info("代理程式啟動", { version: this.options.version });
    await this.heartbeat();
    await this.poll();
    this.realtime.start();
    this.scheduleHeartbeat();
    this.schedulePoll();
  }

  /** 停止:不再接新工作,等佇列裡的印完。 */
  async stop(): Promise<void> {
    this.running = false;
    this.realtime.stop();
    for (const timer of [this.pollTimer, this.heartbeatTimer]) {
      if (timer !== null) {
        this.timers.clear(timer);
      }
    }
    this.pollTimer = null;
    this.heartbeatTimer = null;
    await this.idle();
    this.options.logger.info("代理程式已停止");
  }

  /** 認領與佇列都跑完(停止服務、測試用)。 */
  async idle(): Promise<void> {
    while (this.claiming.size > 0) {
      await Promise.all(this.claiming);
    }
    await this.runner.idle();
  }

  handleSignal(signal: RealtimeSignal): void {
    if (signal.type !== PRINT_SIGNALS.job || signal.id === undefined) {
      return;
    }
    void this.take(signal.id, "signal");
  }

  /** 拿未完成工作並逐張認領(啟動、即時通道沒連上時每 60 秒、重新連上時補抓)。 */
  async poll(): Promise<void> {
    let response;
    try {
      response = await this.options.api.jobs();
    } catch (error) {
      this.reportApiError("拿工作失敗", error);
      return;
    }
    this.unauthorized = false;
    this.printers.clear();
    for (const printer of response.printers) {
      this.printers.set(printer.id, printer);
    }
    await Promise.all(response.jobs.map((job) => this.take(job.id, "poll")));
  }

  /** 心跳:版本 + 各印表機狀態。 */
  async heartbeat(): Promise<void> {
    const printers: { id: string; status: PrinterStatus }[] = [];
    for (const printer of this.printers.values()) {
      if (printer.enabled) {
        printers.push({
          id: printer.id,
          status: await this.runner.probe(printer),
        });
      }
    }
    try {
      await this.options.api.heartbeat({
        version: this.options.version,
        printers,
      });
      this.unauthorized = false;
    } catch (error) {
      this.reportApiError("心跳失敗", error);
    }
  }

  private handleStatus(status: RealtimeLinkStatus): void {
    const previous = this.status;
    this.status = status;
    if (status === "live" && previous !== "live" && this.running) {
      // 斷線期間可能錯過信號:重新連上先補抓一次
      void this.track(this.poll());
    }
  }

  private schedulePoll(): void {
    this.pollTimer = this.timers.set(() => {
      this.pollTimer = null;
      if (!this.running) {
        return;
      }
      const tick = this.status === "live" ? Promise.resolve() : this.poll();
      void tick.finally(() => {
        if (this.running) {
          this.schedulePoll();
        }
      });
    }, PRINT_AGENT_POLL_INTERVAL_MS);
  }

  private scheduleHeartbeat(): void {
    this.heartbeatTimer = this.timers.set(() => {
      this.heartbeatTimer = null;
      if (!this.running) {
        return;
      }
      void this.heartbeat().finally(() => {
        if (this.running) {
          this.scheduleHeartbeat();
        }
      });
    }, PRINT_AGENT_HEARTBEAT_INTERVAL_MS);
  }

  private pruneHandled(now: number): void {
    for (const [id, at] of this.handled) {
      if (now - at > HANDLED_JOB_TTL_MS) {
        this.handled.delete(id);
      }
    }
  }

  /** 認領一張工作,成功才排進佇列;本機已處理過的 id 直接略過。 */
  private take(jobId: string, source: "signal" | "poll"): Promise<void> {
    return this.track(this.claim(jobId, source));
  }

  /** 記下進行中的認領 / 補抓,`idle()` 會等它們。 */
  private track(task: Promise<void>): Promise<void> {
    this.claiming.add(task);
    void task.finally(() => this.claiming.delete(task));
    return task;
  }

  private async claim(jobId: string, source: "signal" | "poll"): Promise<void> {
    const now = this.timers.now();
    this.pruneHandled(now);
    if (this.handled.has(jobId)) {
      return;
    }
    this.handled.set(jobId, now);
    let claimed;
    try {
      claimed = await this.options.api.claim(jobId);
    } catch (error) {
      // 網路錯誤:讓下一次信號 / 輪詢還能再試
      this.handled.delete(jobId);
      this.reportApiError("認領失敗", error, { jobId });
      return;
    }
    if (claimed === null) {
      this.options.logger.info("工作已被認領或已逾時,略過", { jobId, source });
      return;
    }
    this.printers.set(claimed.printer.id, claimed.printer);
    this.options.logger.info("已認領", {
      jobId,
      source,
      printerId: claimed.printer.id,
    });
    // 不等印完:輪詢只負責認領,列印在佇列裡依序跑
    void this.enqueue(claimed.printer, claimed.job);
  }

  private enqueue(
    printer: PrintAgentPrinter,
    job: PrintAgentJob,
  ): Promise<void> {
    return this.runner.enqueue(printer, job);
  }

  private reportApiError(
    message: string,
    error: unknown,
    fields: Record<string, string> = {},
  ): void {
    if (error instanceof PrintAgentApiError && error.unauthorized) {
      // 金鑰被撤銷(重新配對、停用):同一段期間只記一次,不洗版
      if (!this.unauthorized) {
        this.unauthorized = true;
        this.options.logger.error(
          "代理程式金鑰無效或已撤銷:請在印表機管理頁重新配對後執行 pair --force",
        );
      }
      return;
    }
    this.options.logger.warn(message, { ...fields, error: errorText(error) });
  }
}
