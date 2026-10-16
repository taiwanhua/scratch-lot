import {
  REALTIME_CLOSE_CODES,
  REALTIME_TICKET_TTL_SECONDS,
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

/** 看板頁開著的看板:專案登記的看板 key + 那家店的組織 id。 */
export interface RealtimeBoard {
  key: string;
  orgId: string;
}

export interface RealtimeConnectionOptions {
  /** 向 API 拿訂閱憑證(`realtimeTicket`);停用時回 null。 */
  fetchTicket(board: RealtimeBoard | null): Promise<RealtimeGrant | null>;
  onSignal(signal: RealtimeSignal, topic: string): void;
  onStatus(status: RealtimeStatus): void;
  /** 斷線(或停用)一段時間後重新連上:先補抓一次資料。 */
  onCatchUp(): void;
  createSocket?: (url: string) => RealtimeSocket;
  timers?: RealtimeTimers;
}

/** 到期前多久在原連線上換發(毫秒)。 */
export const RENEW_BEFORE_MS = 60_000;
/** 換發的最小間隔(毫秒):時間異常時也不會連續換發。 */
export const MIN_RENEW_DELAY_MS = 30_000;
/**
 * 收到憑證後多久換發(毫秒):以「收到的時刻 + (效期 − 1 分鐘)」計算,不拿憑證的 `expiresAt` 對使用者電腦的時鐘
 * (時鐘不準時會太早或太晚換發)。
 */
export const RENEW_AFTER_MS = Math.max(
  MIN_RENEW_DELAY_MS,
  REALTIME_TICKET_TTL_SECONDS * 1000 - RENEW_BEFORE_MS,
);
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

const sameBoard = (a: RealtimeBoard | null, b: RealtimeBoard | null) =>
  a === b ||
  (a !== null && b !== null && a.key === b.key && a.orgId === b.orgId);

/**
 * 一條即時通道連線的生命週期(底座規格第 4 章「四個流程」「降級」;不碰 React,`RealtimeProvider` 持有它):
 *
 * - **建立連線**:拿訂閱憑證(平常只含 `user:<自己>`)→ `wss://…/connect?ticket=`
 * - **換發**:收到憑證後(效期 − 1 分鐘)在**原連線**上送新憑證(`renew`);進出看板頁、換分店、切換目前組織時也換發。
 *   **同一時間只跑一個換發**:跑的期間看板又變(或又要求換發)就記下,`renewed` 之後再補一次,
 *   所以先後兩次拿憑證的回應順序顛倒也不會用到舊的。換到含 `board:<店>` 才送 `subscribe`,離開先 `unsubscribe`
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
  private board: RealtimeBoard | null = null;
  /** 目前訂閱中的看板店(`board:<orgId>` 的 orgId)。 */
  private subscribedBoard: string | null = null;
  /** 換發進行中(拿憑證到收到 `renewed` / 被拒為止)。 */
  private renewing = false;
  /** 換發進行中又被要求換發:`renewed` 後再補一次。 */
  private renewAgain = false;
  /** 已送出、等 `renewed` 的換發。 */
  private pendingRenew: { grant: RealtimeGrant; receivedAt: number } | null =
    null;

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
    this.resetRenew();
    socket?.close(1000, "stop");
  }

  /** 看板頁開著哪個看板的哪家店(離開傳 null):在原連線上換發,符合條件才訂閱 `board:<店>`。 */
  setBoard(board: RealtimeBoard | null): void {
    if (sameBoard(board, this.board)) {
      return;
    }
    this.board = board;
    if (!this.isLive) {
      // 連上時用目前的看板拿憑證,開線後再訂閱
      return;
    }
    if (
      this.subscribedBoard !== null &&
      this.subscribedBoard !== board?.orgId
    ) {
      this.send({
        op: "unsubscribe",
        topic: boardTopic(this.subscribedBoard),
      });
      this.subscribedBoard = null;
    }
    this.requestRenew();
  }

  /** 立即換發(切換目前組織時:跨租戶要換到新租戶的 Durable Object)。 */
  refresh(): void {
    if (this.isLive) {
      this.requestRenew();
    }
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

  private resetRenew(): void {
    this.renewing = false;
    this.renewAgain = false;
    this.pendingRenew = null;
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
    const receivedAt = this.timers.now();
    const socket = this.createSocket(
      `${grant.connectUrl}?ticket=${encodeURIComponent(grant.ticket)}`,
    );
    this.socket = socket;
    this.subscribedBoard = null;
    this.resetRenew();
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
      this.scheduleRenew(receivedAt);
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
      this.resetRenew();
      this.clearTimer();
      this.setStatus("slow");
      this.reconnectLater(event.code === REALTIME_CLOSE_CODES.ticketExpired);
    });
  }

  private send(message: unknown): void {
    this.socket?.send(JSON.stringify(message));
  }

  /** 以收到憑證的時刻起算(不比對 `expiresAt` 與使用者電腦的時鐘)。 */
  private scheduleRenew(receivedAt: number): void {
    const delay = Math.max(
      MIN_RENEW_DELAY_MS,
      receivedAt + RENEW_AFTER_MS - this.timers.now(),
    );
    this.schedule(() => {
      this.requestRenew();
    }, delay);
  }

  private requestRenew(): void {
    if (this.renewing) {
      this.renewAgain = true;
      return;
    }
    void this.renew();
  }

  private async renew(): Promise<void> {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    this.renewing = true;
    let grant: RealtimeGrant | null = null;
    try {
      grant = await this.options.fetchTicket(this.board);
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
    this.pendingRenew = { grant, receivedAt: this.timers.now() };
    this.send({ op: "renew", ticket: grant.ticket });
  }

  /** 關掉目前連線並重新連(換發被拒、拿不到憑證)。 */
  private restart(): void {
    const socket = this.socket;
    this.socket = null;
    this.isLive = false;
    this.resetRenew();
    socket?.close(1000, "restart");
    this.setStatus("slow");
    this.reconnectLater(true);
  }

  private subscribeBoardIfAllowed(grant: RealtimeGrant): void {
    const orgId = this.board?.orgId;
    if (
      orgId !== undefined &&
      this.subscribedBoard !== orgId &&
      grant.topics.includes(boardTopic(orgId))
    ) {
      this.send({ op: "subscribe", topic: boardTopic(orgId) });
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
        const pending = this.pendingRenew;
        this.pendingRenew = null;
        this.renewing = false;
        if (pending !== null) {
          this.scheduleRenew(pending.receivedAt);
          this.subscribeBoardIfAllowed(pending.grant);
        }
        if (this.renewAgain) {
          this.renewAgain = false;
          this.requestRenew();
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
          this.restart();
        }
        return;
      }
    }
  }
}
