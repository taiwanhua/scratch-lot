import {
  REALTIME_CLOSE_CODES,
  type RealtimeServerMessage,
  type RealtimeSignal,
  boardTopic,
} from "@repo/domain/realtime";

/**
 * 即時通道的連線狀態(頭像選單的小圓點):`live` = 即時(綠);其餘 = 重新連線中 / 慢速模式(黃),
 * 期間由 `RealtimeProvider` 每 60 秒輪詢。
 */
export type RealtimeStatus = "connecting" | "live" | "slow";

/** `realtimeTicket` 的回傳(與 GraphQL `RealtimeTicketPayload` 同形)。 */
export interface RealtimeGrant {
  ticket: string;
  connectUrl: string;
  /** 到期時間(Unix 秒)。 */
  expiresAt: number;
  topics: string[];
}

/** 連線需要的 WebSocket 能力(測試換成假的)。 */
export interface RealtimeSocket {
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

export interface RealtimeTimers {
  now(): number;
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface RealtimeConnectionOptions {
  /** 向 API 拿訂閱憑證(`realtimeTicket`);停用時回 null。 */
  fetchTicket(boardOrgId: string | null): Promise<RealtimeGrant | null>;
  onSignal(signal: RealtimeSignal, topic: string): void;
  onStatus(status: RealtimeStatus): void;
  /** 斷線(或停用)一段時間後重新連上:先補抓一次資料。 */
  onCatchUp(): void;
  createSocket?: (url: string) => RealtimeSocket;
  timers?: RealtimeTimers;
}

/** 到期前多久在原連線上換發(毫秒)。 */
export const RENEW_BEFORE_MS = 60_000;
/** 重連退避(毫秒):依失敗次數取,用完停在最後一個。 */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
/** 即時通道停用(憑證是 null)時,多久再問一次 API(毫秒)。 */
export const DISABLED_RETRY_MS = 60_000;

/** 瀏覽器的計時器(provider 的輪詢也用它;測試注入手動推進的版本)。 */
export const browserTimers: RealtimeTimers = {
  now: () => Date.now(),
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const browserSocket = (url: string): RealtimeSocket => new WebSocket(url);

const BOARD_PREFIX = "board:";

const parseMessage = (data: unknown): RealtimeServerMessage | null => {
  if (typeof data !== "string") {
    return null;
  }
  try {
    return JSON.parse(data) as RealtimeServerMessage;
  } catch {
    return null;
  }
};

/**
 * 一條即時通道連線的生命週期(底座規格第 4 章「四個流程」「降級」;不碰 React,`RealtimeProvider` 持有它):
 *
 * - **建立連線**:拿訂閱憑證(平常只含 `user:<自己>`)→ `wss://…/connect?ticket=`
 * - **換發**:到期前 1 分鐘在**原連線**上送新憑證(`renew`);進出看板頁、換分店時也換發
 *   (帶 `boardOrgId`),換到含 `board:<店>` 才送 `subscribe`,離開先 `unsubscribe` 再換回只含自己的憑證
 * - **重連退避**:斷線後依 1 / 2 / 5 / 10 / 30 秒重連;憑證過期被關(4001)立即重拿憑證重連;
 *   換發被拒(切換到別的租戶、憑證無效)→ 關掉重連
 * - **降級與補抓**:不是 `live` 的期間狀態為 `slow`(輪詢由 provider 做);斷線後重新連上先 `onCatchUp`
 */
export class RealtimeConnection {
  private readonly createSocket: (url: string) => RealtimeSocket;
  private readonly timers: RealtimeTimers;
  private socket: RealtimeSocket | null = null;
  private isLive = false;
  private status: RealtimeStatus | null = null;
  private timer: unknown = null;
  private failures = 0;
  private hadOutage = false;
  private stopped = true;
  private board: string | null = null;
  private subscribedBoard: string | null = null;
  /** 最後一次送出的換發(收到 `renewed` 時用它排下一次)。 */
  private pendingRenew: RealtimeGrant | null = null;

  constructor(private readonly options: RealtimeConnectionOptions) {
    this.createSocket = options.createSocket ?? browserSocket;
    this.timers = options.timers ?? browserTimers;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.setStatus("connecting");
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    const socket = this.socket;
    this.socket = null;
    this.isLive = false;
    socket?.close(1000, "stop");
  }

  /** 看板頁開著哪家店(離開傳 null):在原連線上換發,符合條件才訂閱 `board:<店>`。 */
  setBoard(orgId: string | null): void {
    if (orgId === this.board) {
      return;
    }
    this.board = orgId;
    if (!this.isLive) {
      // 連上時用目前的看板拿憑證,開線後再訂閱
      return;
    }
    if (this.subscribedBoard !== null && this.subscribedBoard !== orgId) {
      this.send({
        op: "unsubscribe",
        topic: boardTopic(this.subscribedBoard),
      });
      this.subscribedBoard = null;
    }
    void this.renew();
  }

  private setStatus(status: RealtimeStatus): void {
    if (status !== "live" && status !== "connecting") {
      this.hadOutage = true;
    }
    if (status !== this.status) {
      this.status = status;
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
    let grant: RealtimeGrant | null;
    try {
      grant = await this.options.fetchTicket(this.board);
    } catch {
      this.setStatus("slow");
      this.reconnectLater();
      return;
    }
    if (this.stopped) {
      return;
    }
    if (grant === null) {
      // 即時通道停用:慢速模式,過一陣子再問
      this.setStatus("slow");
      this.schedule(() => void this.open(), DISABLED_RETRY_MS);
      return;
    }
    const socket = this.createSocket(
      `${grant.connectUrl}?ticket=${encodeURIComponent(grant.ticket)}`,
    );
    this.socket = socket;
    this.subscribedBoard = null;
    this.pendingRenew = null;
    const opened = grant;
    socket.addEventListener("open", () => {
      if (socket !== this.socket) {
        return;
      }
      this.failures = 0;
      this.isLive = true;
      const catchUp = this.hadOutage;
      this.hadOutage = false;
      this.setStatus("live");
      this.scheduleRenew(opened.expiresAt);
      this.subscribeBoardIfAllowed(opened);
      if (catchUp) {
        this.options.onCatchUp();
      }
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
      this.isLive = false;
      this.clearTimer();
      this.setStatus("slow");
      this.reconnectLater(event.code === REALTIME_CLOSE_CODES.ticketExpired);
    });
  }

  private send(message: unknown): void {
    this.socket?.send(JSON.stringify(message));
  }

  private scheduleRenew(expiresAt: number): void {
    const delay = Math.max(
      0,
      expiresAt * 1000 - this.timers.now() - RENEW_BEFORE_MS,
    );
    this.schedule(() => void this.renew(), delay);
  }

  private async renew(): Promise<void> {
    const socket = this.socket;
    let grant: RealtimeGrant | null = null;
    try {
      grant = await this.options.fetchTicket(this.board);
    } catch {
      grant = null;
    }
    if (socket === null || socket !== this.socket) {
      return;
    }
    if (grant === null) {
      // 拿不到新憑證(停用、暫時失敗):關掉,交給重連流程
      this.restart();
      return;
    }
    this.pendingRenew = grant;
    this.send({ op: "renew", ticket: grant.ticket });
  }

  /** 關掉目前連線並重新連(換發被拒、拿不到憑證)。 */
  private restart(): void {
    const socket = this.socket;
    this.socket = null;
    this.isLive = false;
    socket?.close(1000, "restart");
    this.setStatus("slow");
    this.reconnectLater(true);
  }

  private subscribeBoardIfAllowed(grant: RealtimeGrant): void {
    const board = this.board;
    if (
      board !== null &&
      this.subscribedBoard !== board &&
      grant.topics.includes(boardTopic(board))
    ) {
      this.send({ op: "subscribe", topic: boardTopic(board) });
    }
  }

  private handle(message: RealtimeServerMessage | null): void {
    if (message === null) {
      return;
    }
    switch (message.op) {
      case "signal": {
        this.options.onSignal(message.signal, message.topic);
        return;
      }
      case "renewed": {
        const grant = this.pendingRenew;
        this.pendingRenew = null;
        this.scheduleRenew(message.exp);
        if (grant !== null) {
          this.subscribeBoardIfAllowed(grant);
        }
        return;
      }
      case "subscribed": {
        if (message.topic.startsWith(BOARD_PREFIX)) {
          this.subscribedBoard = message.topic.slice(BOARD_PREFIX.length);
        }
        return;
      }
      case "unsubscribed": {
        return;
      }
      case "rejected": {
        if (
          this.pendingRenew !== null &&
          (message.reason === "ticket-mismatch" ||
            message.reason === "invalid-ticket")
        ) {
          this.pendingRenew = null;
          this.restart();
        }
        return;
      }
    }
  }
}
