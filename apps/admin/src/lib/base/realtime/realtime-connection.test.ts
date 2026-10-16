import { beforeEach, describe, expect, it } from "@jest/globals";

import {
  FakeSocket,
  ManualTimers,
  flushPromises,
  grantOf,
} from "@/test/realtime";

import {
  DISABLED_RETRY_MS,
  RECONNECT_BACKOFF_MS,
  RealtimeConnection,
  type RealtimeGrant,
  type RealtimeStatus,
} from "./realtime-connection";

describe("RealtimeConnection", () => {
  let timers: ManualTimers;
  let sockets: FakeSocket[];
  let statuses: RealtimeStatus[];
  let catchUps: number;
  let signals: { type: string; topic: string }[];
  let ticketCalls: (string | null)[];
  let nextGrant: (board: string | null) => RealtimeGrant | null;

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
        ticketCalls.push(board);
        return Promise.resolve(nextGrant(board));
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
    instance.setBoard("A");
    await flushPromises();
    expect(ticketCalls.at(-1)).toBe("A");
    expect(latest().sent).toEqual([{ op: "renew", ticket: "ticket-2" }]);
    latest().receive({ op: "renewed", exp: 1 });
    expect(latest().sent.at(-1)).toEqual({ op: "subscribe", topic: "board:A" });
    latest().receive({ op: "subscribed", topic: "board:A" });

    instance.setBoard("B");
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
    instance.setBoard("A");
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
