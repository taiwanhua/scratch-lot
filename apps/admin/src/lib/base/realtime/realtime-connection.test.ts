import { beforeEach, describe, expect, it } from "@jest/globals";

import {
  MIN_RENEW_DELAY_MS,
  RECONNECT_BACKOFF_MS,
} from "@repo/domain/realtime";

import {
  FakeSocket,
  ManualTimers,
  flushPromises,
  grantOf,
} from "@/test/realtime";

import {
  DISABLED_RETRY_MS,
  RENEW_AFTER_MS,
  RealtimeConnection,
  type RealtimeGrant,
  type RealtimeStatus,
} from "./realtime-connection";

const board = (orgId: string) => ({ key: "store-board", orgId });

describe("RealtimeConnection", () => {
  let timers: ManualTimers;
  let sockets: FakeSocket[];
  let statuses: RealtimeStatus[];
  let catchUps: number;
  let signals: { type: string; topic: string }[];
  let ticketCalls: (string | null)[];
  let nextGrant: (board: string | null) => RealtimeGrant | null;
  let fetchOverride:
    ((board: string | null) => Promise<RealtimeGrant | null>) | null;

  const latest = (): FakeSocket => {
    const socket = sockets.at(-1);
    if (socket === undefined) {
      throw new Error("還沒有連線");
    }
    return socket;
  };

  const connection = () =>
    new RealtimeConnection({
      fetchTicket: (board) => {
        ticketCalls.push(board?.orgId ?? null);
        return fetchOverride === null
          ? Promise.resolve(nextGrant(board?.orgId ?? null))
          : fetchOverride(board?.orgId ?? null);
      },
      onSignal: (signal, topic) => signals.push({ type: signal.type, topic }),
      onStatus: (status) => statuses.push(status),
      onCatchUp: () => {
        catchUps += 1;
      },
      createSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      timers,
    });

  const started = async () => {
    const instance = connection();
    instance.start();
    await flushPromises();
    latest().open();
    return instance;
  };

  beforeEach(() => {
    timers = new ManualTimers();
    sockets = [];
    statuses = [];
    catchUps = 0;
    signals = [];
    ticketCalls = [];
    fetchOverride = null;
    nextGrant = (board) =>
      grantOf(
        timers,
        board === null ? ["user:u1"] : ["user:u1", `board:${board}`],
        `ticket-${String(ticketCalls.length)}`,
      );
  });

  it("登入後拿只含自己的憑證連線;狀態變成 live;信號交給 onSignal", async () => {
    await started();
    expect(ticketCalls).toEqual([null]);
    expect(latest().url).toBe("wss://rt.test/connect?ticket=ticket-1");
    expect(statuses).toEqual(["connecting", "live"]);
    latest().receive({
      op: "signal",
      topic: "user:u1",
      signal: { type: "badge:apply-center" },
    });
    expect(signals).toEqual([{ type: "badge:apply-center", topic: "user:u1" }]);
    expect(catchUps).toBe(0);
  });

  it("使用者電腦時鐘不準(比伺服器快 1 小時 / 慢 1 小時)→ 仍在收到憑證後 9 分鐘換發", async () => {
    for (const skewSeconds of [3600, -3600]) {
      timers = new ManualTimers();
      sockets = [];
      nextGrant = () => ({
        ...grantOf(timers),
        // 憑證的 exp 用伺服器時間,對使用者電腦看起來早已過期 / 很久以後才到期
        expiresAt: Math.floor(timers.now() / 1000) - skewSeconds + 600,
      });
      const instance = await started();
      await timers.advance(RENEW_AFTER_MS - 1);
      expect(latest().sent).toEqual([]);
      await timers.advance(1);
      expect(latest().sent).toHaveLength(1);
      instance.stop();
    }
  });

  it("換發間隔最少 30 秒", () => {
    expect(MIN_RENEW_DELAY_MS).toBe(30_000);
    expect(RENEW_AFTER_MS).toBe(540_000);
  });

  it("換發一次只跑一個:拿憑證期間又換分店 → renewed 後補一次;回應順序顛倒也不會用到舊的", async () => {
    const instance = await started();
    const pending: ((grant: RealtimeGrant) => void)[] = [];
    fetchOverride = () =>
      new Promise((resolve) => {
        pending.push(resolve);
      });
    instance.setBoard(board("A"));
    instance.setBoard(board("B"));
    await flushPromises();
    // 第二次換發等第一次跑完才開始
    expect(ticketCalls.slice(1)).toEqual(["A"]);
    pending[0]?.(grantOf(timers, ["user:u1", "board:A"], "ticket-A"));
    await flushPromises();
    expect(latest().sent).toEqual([{ op: "renew", ticket: "ticket-A" }]);
    latest().receive({ op: "renewed", exp: 1 });
    await flushPromises();
    // A 的憑證回來時看板已是 B:不訂閱 A,接著補換發 B
    expect(
      latest().sent.some((m) => JSON.stringify(m).includes("subscribe")),
    ).toBe(false);
    expect(ticketCalls.slice(1)).toEqual(["A", "B"]);
    pending[1]?.(grantOf(timers, ["user:u1", "board:B"], "ticket-B"));
    await flushPromises();
    latest().receive({ op: "renewed", exp: 1 });
    expect(latest().sent.slice(-2)).toEqual([
      { op: "renew", ticket: "ticket-B" },
      { op: "subscribe", topic: "board:B" },
    ]);
  });

  it("refresh(切換目前組織)→ 立即在原連線換發;換到別的租戶被拒 → 重新連線", async () => {
    const instance = await started();
    instance.refresh();
    await flushPromises();
    expect(latest().sent).toEqual([{ op: "renew", ticket: "ticket-2" }]);
    latest().receive({ op: "rejected", reason: "ticket-mismatch" });
    await timers.advance(0);
    expect(sockets).toHaveLength(2);
  });

  it("到期前 1 分鐘在原連線上換發(不重新連線)", async () => {
    await started();
    await timers.advance(539_000);
    expect(latest().sent).toEqual([]);
    await timers.advance(1000);
    expect(sockets).toHaveLength(1);
    expect(latest().sent).toEqual([{ op: "renew", ticket: "ticket-2" }]);
    latest().receive({
      op: "renewed",
      exp: Math.floor(timers.now() / 1000) + 600,
    });
    await timers.advance(540_000);
    expect(latest().sent).toHaveLength(2);
  });

  it("斷線 → 慢速模式;依退避重連,連上後先補抓一次", async () => {
    await started();
    latest().drop();
    expect(statuses.at(-1)).toBe("slow");
    await timers.advance((RECONNECT_BACKOFF_MS[0] ?? 0) - 1);
    expect(sockets).toHaveLength(1);
    await timers.advance(1);
    expect(sockets).toHaveLength(2);
    // 第二次也連不上:退避加長
    latest().drop();
    await timers.advance((RECONNECT_BACKOFF_MS[1] ?? 0) - 1);
    expect(sockets).toHaveLength(2);
    await timers.advance(1);
    expect(sockets).toHaveLength(3);
    latest().open();
    expect(statuses.at(-1)).toBe("live");
    expect(catchUps).toBe(1);
  });

  it("憑證過期被關(4001)→ 立即拿新憑證重連", async () => {
    await started();
    latest().drop(4001);
    await timers.advance(0);
    expect(sockets).toHaveLength(2);
    expect(ticketCalls).toHaveLength(2);
  });

  it("換發被拒(切到別的租戶)→ 關掉原連線重新連", async () => {
    await started();
    await timers.advance(540_000);
    const first = latest();
    first.receive({ op: "rejected", reason: "ticket-mismatch" });
    expect(first.closedWith).toBe(1000);
    await timers.advance(0);
    expect(sockets).toHaveLength(2);
  });

  it("即時通道停用(憑證 null)→ 慢速模式,60 秒後再問;之後連上補抓一次", async () => {
    nextGrant = () => null;
    const instance = connection();
    instance.start();
    await flushPromises();
    expect(statuses).toEqual(["connecting", "slow"]);
    expect(sockets).toHaveLength(0);
    nextGrant = () => grantOf(timers);
    await timers.advance(DISABLED_RETRY_MS);
    latest().open();
    expect(statuses.at(-1)).toBe("live");
    expect(catchUps).toBe(1);
    instance.stop();
  });

  it("進入看板頁:原連線換發含 board:A 再訂閱;切到 B 先取消 A;離開取消並換回只含自己", async () => {
    const instance = await started();
    instance.setBoard(board("A"));
    await flushPromises();
    expect(ticketCalls.at(-1)).toBe("A");
    expect(latest().sent).toEqual([{ op: "renew", ticket: "ticket-2" }]);
    latest().receive({ op: "renewed", exp: 1 });
    expect(latest().sent.at(-1)).toEqual({ op: "subscribe", topic: "board:A" });
    latest().receive({ op: "subscribed", topic: "board:A" });

    instance.setBoard(board("B"));
    await flushPromises();
    expect(latest().sent.slice(-2)).toEqual([
      { op: "unsubscribe", topic: "board:A" },
      { op: "renew", ticket: "ticket-3" },
    ]);
    latest().receive({ op: "renewed", exp: 1 });
    expect(latest().sent.at(-1)).toEqual({ op: "subscribe", topic: "board:B" });
    latest().receive({ op: "subscribed", topic: "board:B" });

    instance.setBoard(null);
    await flushPromises();
    expect(ticketCalls.at(-1)).toBeNull();
    expect(latest().sent.slice(-2)).toEqual([
      { op: "unsubscribe", topic: "board:B" },
      { op: "renew", ticket: "ticket-4" },
    ]);
    expect(sockets).toHaveLength(1);
  });

  it("沒有看板權限(換發的憑證不含 board:)→ 不送 subscribe", async () => {
    nextGrant = () => grantOf(timers, ["user:u1"]);
    const instance = await started();
    instance.setBoard(board("A"));
    await flushPromises();
    latest().receive({ op: "renewed", exp: 1 });
    expect(latest().sent).toEqual([{ op: "renew", ticket: "t1" }]);
  });

  it("stop:關閉連線、不再重連", async () => {
    const instance = await started();
    instance.stop();
    expect(latest().closedWith).toBe(1000);
    latest().drop();
    await timers.advance(60_000);
    expect(sockets).toHaveLength(1);
  });
});
