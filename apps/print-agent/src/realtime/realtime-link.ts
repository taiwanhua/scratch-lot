import {
  MIN_RENEW_DELAY_MS,
  REALTIME_CLOSE_CODES,
  REALTIME_PING,
  REALTIME_PING_INTERVAL_MS,
  REALTIME_PONG_TIMEOUT_MS,
  REALTIME_TICKET_TTL_SECONDS,
  RECONNECT_BACKOFF_MS,
  RENEW_BEFORE_MS,
  type RealtimeServerMessage,
  type RealtimeSignal,
} from "@repo/domain/realtime";

import type { Logger } from "../logging/logger";
import { type Timers, systemTimers } from "../timers";

/**
 * 代理程式的即時通道連線(底座規格第 4 章「四個流程」「降級」、第 6 章「代理程式」的 `realtime`):
 *
 * - **建立連線**:`POST /print-agent/realtime-ticket` 拿訂閱憑證(只含 `print-agent:<自己>`)→
 *   `wss://…/connect?ticket=`;Durable Object 初始訂閱 `print-agent:<自己>`,不必再送 `subscribe`。
 * - **換發**:收到憑證後(效期 − 1 分鐘,最少 30 秒)在**原連線**上送 `renew`;不拿 `expiresAt` 對本機時鐘。
 *   送出後 15 秒沒有回應(`renewed` / `rejected`)就關掉重連。時間常數與 admin 共用 `@repo/domain/realtime`。
 * - **偵測半開連線**(連線其實斷了、兩端都沒發現):連上後每 30 秒送 `REALTIME_PING`,10 秒內沒收到 `pong` 就關掉重連
 *   (`down` → 輪詢降級 → 重新連上先補抓)。Durable Object 以 auto-response 回 pong,不喚醒、不計時長費用。
 *   換發約 9 分鐘才一次,只靠換發逾時要好幾分鐘才發現;送出的工作 2 分鐘沒被認領就標「代理程式離線」。
 * - **重連退避**:斷線後依 1 / 2 / 5 / 10 / 30 秒重連;憑證過期被關(4001)立即重拿憑證;換發被拒 → 關掉重連。
 * - **停用**:API 回的憑證是 null(該環境沒有即時通道)→ 狀態 `down`,60 秒後再問。
 *
 * 協定與 admin 的 `RealtimeConnection`(`apps/admin/src/lib/base/realtime/realtime-connection.ts`)同一份
 * (`@repo/domain/realtime`);代理程式沒有看板、不切組織,只保留連線、換發、退避三件事。
 * 狀態 `down` 的期間由 agent 每 60 秒輪詢;回到 `live` 時 agent 先補抓一次。
 */
export type RealtimeLinkStatus = "live" | "down";

export interface AgentTicket {
  ticket: string;
  connectUrl: string;
}

/** 連線需要的 WebSocket 能力(Node 24 內建 `WebSocket`;測試換成假的)。 */
export interface AgentSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number }) => void,
  ): void;
}

export interface RealtimeLinkOptions {
  /** 拿訂閱憑證;即時通道停用時回 null。 */
  fetchTicket(): Promise<AgentTicket | null>;
  onSignal(signal: RealtimeSignal): void;
  onStatus(status: RealtimeLinkStatus): void;
  logger?: Logger;
  createSocket?: (url: string) => AgentSocket;
  timers?: Timers;
}

/** 收到憑證後多久換發(毫秒)。 */
export const RENEW_AFTER_MS = Math.max(
  MIN_RENEW_DELAY_MS,
  REALTIME_TICKET_TTL_SECONDS * 1000 - RENEW_BEFORE_MS,
);
/** 送出換發後多久沒收到 `renewed` / `rejected` 就當連線壞了,關掉重連(毫秒)。 */
export const RENEW_RESPONSE_TIMEOUT_MS = 15_000;
/** 即時通道停用(憑證是 null)時多久再問(毫秒)。 */
export const DISABLED_RETRY_MS = 60_000;

/** Node 24 內建的 WebSocket 客戶端(不另裝套件)。 */
const nodeSocket = (url: string): AgentSocket => new WebSocket(url);

function parseMessage(data: unknown): RealtimeServerMessage | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    return JSON.parse(data) as RealtimeServerMessage;
  } catch {
    return null;
  }
}

export class RealtimeLink {
  private readonly createSocket: (url: string) => AgentSocket;
  private readonly timers: Timers;
  private socket: AgentSocket | null = null;
  private status: RealtimeLinkStatus | null = null;
  private timer: unknown = null;
  private failures = 0;
  private stopped = true;
  /** 已送出、等 `renewed` 的換發:記下拿到新憑證的時刻(下一次換發由它起算)。 */
  private pendingRenewAt: number | null = null;
  private renewing = false;
  /** 下一次送 ping 的計時。 */
  private pingTimer: unknown = null;
  /** 已送出 ping、等 pong 的逾時計時(收到 pong 就清掉)。 */
  private pongTimer: unknown = null;

  constructor(private readonly options: RealtimeLinkOptions) {
    this.createSocket = options.createSocket ?? nodeSocket;
    this.timers = options.timers ?? systemTimers;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    this.resetRenew();
    this.stopPing();
    socket?.close(1000, "stop");
  }

  private setStatus(status: RealtimeLinkStatus): void {
    if (status !== this.status) {
      this.status = status;
      this.options.logger?.info(
        status === "live" ? "即時通道已連線" : "即時通道未連線:改每 60 秒輪詢",
      );
      this.options.onStatus(status);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  private schedule(callback: () => void, delayMs: number): void {
    this.clearTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      callback();
    }, delayMs);
  }

  private resetRenew(): void {
    this.renewing = false;
    this.pendingRenewAt = null;
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      this.timers.clear(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer !== null) {
      this.timers.clear(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /** 每 30 秒送一次 ping;送出後 10 秒沒有 pong 就關掉重連。 */
  private schedulePing(socket: AgentSocket): void {
    this.pingTimer = this.timers.set(() => {
      this.pingTimer = null;
      if (socket !== this.socket) {
        return;
      }
      this.schedulePing(socket);
      // 先排逾時再送:pong 若在 send 之內就回來(同步),也清得掉這個計時
      this.pongTimer = this.timers.set(() => {
        this.pongTimer = null;
        if (socket === this.socket) {
          this.options.logger?.warn("即時通道沒有回應 ping:重新連線");
          this.restart();
        }
      }, REALTIME_PONG_TIMEOUT_MS);
      try {
        socket.send(REALTIME_PING);
      } catch (error) {
        // 連線已在關閉中:交給重連流程
        this.options.logger?.warn("送不出 ping:重新連線", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.restart();
      }
    }, REALTIME_PING_INTERVAL_MS);
  }

  private reconnectLater(immediately = false): void {
    if (this.stopped) {
      return;
    }
    const delay = immediately
      ? 0
      : (RECONNECT_BACKOFF_MS[
          Math.min(this.failures, RECONNECT_BACKOFF_MS.length - 1)
        ] ?? 0);
    this.failures += 1;
    this.schedule(() => void this.open(), delay);
  }

  private async open(): Promise<void> {
    let grant: AgentTicket | null;
    try {
      grant = await this.options.fetchTicket();
    } catch (error) {
      if (this.stopped) {
        return;
      }
      this.options.logger?.warn("拿不到即時通道訂閱憑證", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.setStatus("down");
      this.reconnectLater();
      return;
    }
    if (this.stopped) {
      return;
    }
    if (grant === null) {
      this.setStatus("down");
      this.schedule(() => void this.open(), DISABLED_RETRY_MS);
      return;
    }
    const receivedAt = this.timers.now();
    let socket: AgentSocket;
    try {
      socket = this.createSocket(
        `${grant.connectUrl}?ticket=${encodeURIComponent(grant.ticket)}`,
      );
    } catch (error) {
      this.options.logger?.warn("無法建立即時通道連線", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.setStatus("down");
      this.reconnectLater();
      return;
    }
    this.socket = socket;
    this.resetRenew();
    this.stopPing();
    socket.addEventListener("open", () => {
      if (socket !== this.socket) {
        return;
      }
      this.failures = 0;
      this.setStatus("live");
      this.scheduleRenew(receivedAt);
      this.schedulePing(socket);
    });
    socket.addEventListener("message", (event) => {
      if (socket === this.socket) {
        this.handle(parseMessage(event.data));
      }
    });
    socket.addEventListener("close", (event) => {
      if (socket !== this.socket) {
        return;
      }
      this.socket = null;
      this.resetRenew();
      this.stopPing();
      this.clearTimer();
      this.setStatus("down");
      this.reconnectLater(event.code === REALTIME_CLOSE_CODES.ticketExpired);
    });
  }

  /** 以收到憑證的時刻起算(不比對 `expiresAt` 與本機時鐘)。 */
  private scheduleRenew(receivedAt: number): void {
    const delay = Math.max(
      MIN_RENEW_DELAY_MS,
      receivedAt + RENEW_AFTER_MS - this.timers.now(),
    );
    this.schedule(() => void this.renew(), delay);
  }

  private async renew(): Promise<void> {
    const socket = this.socket;
    if (socket === null || this.renewing) {
      return;
    }
    this.renewing = true;
    let grant: AgentTicket | null = null;
    try {
      grant = await this.options.fetchTicket();
    } catch {
      grant = null;
    }
    if (socket !== this.socket) {
      return;
    }
    if (grant === null) {
      // 拿不到新憑證(停用、暫時失敗):關掉,交給重連流程
      this.restart();
      return;
    }
    this.pendingRenewAt = this.timers.now();
    socket.send(JSON.stringify({ op: "renew", ticket: grant.ticket }));
    // 沒有回應(連線半死、訊息丟失):關掉重連;收到 renewed 時由 scheduleRenew 取代這個計時
    this.schedule(() => {
      if (socket === this.socket && this.pendingRenewAt !== null) {
        this.options.logger?.warn("換發沒有回應:重新連線");
        this.restart();
      }
    }, RENEW_RESPONSE_TIMEOUT_MS);
  }

  /** 關掉目前連線並重新連(換發被拒或逾時、拿不到新憑證、ping 沒有回應)。 */
  private restart(): void {
    const socket = this.socket;
    this.socket = null;
    this.resetRenew();
    this.stopPing();
    socket?.close(1000, "restart");
    this.setStatus("down");
    this.reconnectLater(true);
  }

  private handle(message: RealtimeServerMessage | null): void {
    if (message === null) {
      return;
    }
    switch (message.op) {
      case "signal": {
        this.options.onSignal(message.signal);
        return;
      }
      case "renewed": {
        const at = this.pendingRenewAt;
        this.resetRenew();
        if (at !== null) {
          this.scheduleRenew(at);
        }
        return;
      }
      case "rejected": {
        // 代理程式只送 renew(不送 subscribe):換發中收到任何拒絕都是換發失敗,關掉重連
        if (this.pendingRenewAt !== null) {
          this.restart();
        }
        return;
      }
      case "pong": {
        if (this.pongTimer !== null) {
          this.timers.clear(this.pongTimer);
          this.pongTimer = null;
        }
        return;
      }
      case "subscribed":
      case "unsubscribed": {
        return;
      }
    }
  }
}
