import { describe, expect, it } from "@jest/globals";

import { REALTIME_CLOSE_CODES } from "@repo/domain/realtime";

import { FakeSocket, ManualTimers, freshSecret } from "../test-support/fakes";
import {
  type AgentTicket,
  DISABLED_RETRY_MS,
  RECONNECT_BACKOFF_MS,
  RENEW_AFTER_MS,
  RealtimeLink,
  type RealtimeLinkStatus,
} from "./realtime-link";

function setup(tickets: (AgentTicket | null | Error)[] = []) {
  const timers = new ManualTimers();
  const sockets: FakeSocket[] = [];
  const statuses: RealtimeLinkStatus[] = [];
  const signals: unknown[] = [];
  let fetches = 0;
  const link = new RealtimeLink({
    fetchTicket: () => {
      fetches += 1;
      const next = tickets.length > 0 ? tickets.shift() : undefined;
      if (next instanceof Error) {
        return Promise.reject(next);
      }
      return Promise.resolve(
        next === undefined
          ? {
              ticket: freshSecret(),
              connectUrl: "wss://rt.example.invalid/connect",
            }
          : next,
      );
    },
    onSignal: (signal) => signals.push(signal),
    onStatus: (status) => statuses.push(status),
    timers,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  return {
    link,
    timers,
    sockets,
    statuses,
    signals,
    fetches: () => fetches,
    last: (): FakeSocket => {
      const socket = sockets.at(-1);
      if (socket === undefined) {
        throw new Error("還沒建立連線");
      }
      return socket;
    },
  };
}

describe("代理程式的即時通道連線", () => {
  it("用訂閱憑證連 /connect?ticket=,開線後 live;收到信號轉給 agent", async () => {
    const ticket = freshSecret();
    const { link, timers, last, statuses, signals } = setup([
      { ticket, connectUrl: "wss://rt.example.invalid/connect" },
    ]);
    link.start();
    await timers.advance(0);
    expect(last().url).toBe(
      `wss://rt.example.invalid/connect?ticket=${encodeURIComponent(ticket)}`,
    );
    last().open();
    expect(statuses).toEqual(["live"]);
    last().message({
      op: "signal",
      topic: "print-agent:a1",
      signal: { type: "print-job", id: "j1" },
    });
    expect(signals).toEqual([{ type: "print-job", id: "j1" }]);
    // 代理程式不送 subscribe(Durable Object 初始就訂閱 print-agent:<自己>)
    expect(last().sent).toEqual([]);
    link.stop();
  });

  it("斷線後依 1 / 2 / 5 秒退避重連;連上後歸零", async () => {
    const { link, timers, sockets, last } = setup();
    link.start();
    await timers.advance(0);
    last().drop();
    await timers.advance(RECONNECT_BACKOFF_MS[0] ?? 0);
    expect(sockets).toHaveLength(2);
    last().drop();
    await timers.advance((RECONNECT_BACKOFF_MS[1] ?? 0) - 1);
    expect(sockets).toHaveLength(2);
    await timers.advance(1);
    expect(sockets).toHaveLength(3);
    last().open();
    last().drop();
    await timers.advance(RECONNECT_BACKOFF_MS[0] ?? 0);
    expect(sockets).toHaveLength(4);
    link.stop();
  });

  it("憑證過期被關(4001)立即重拿憑證重連", async () => {
    const { link, timers, sockets, last } = setup();
    link.start();
    await timers.advance(0);
    last().open();
    last().drop(REALTIME_CLOSE_CODES.ticketExpired);
    await timers.advance(0);
    expect(sockets).toHaveLength(2);
    link.stop();
  });

  it("到期前在原連線換發(renew),renewed 後排下一次;不重新連線", async () => {
    const renewTicket = freshSecret();
    const { link, timers, sockets, last, fetches } = setup([
      { ticket: freshSecret(), connectUrl: "wss://rt.example.invalid/connect" },
      { ticket: renewTicket, connectUrl: "wss://rt.example.invalid/connect" },
    ]);
    link.start();
    await timers.advance(0);
    last().open();
    await timers.advance(RENEW_AFTER_MS);
    expect(last().sent).toEqual([
      JSON.stringify({ op: "renew", ticket: renewTicket }),
    ]);
    last().message({ op: "renewed", exp: 0 });
    await timers.advance(RENEW_AFTER_MS);
    expect(last().sent).toHaveLength(2);
    expect(sockets).toHaveLength(1);
    expect(fetches()).toBe(3);
    link.stop();
  });

  it("換發被拒(invalid-ticket)→ 關掉重連", async () => {
    const { link, timers, sockets, last } = setup();
    link.start();
    await timers.advance(0);
    last().open();
    await timers.advance(RENEW_AFTER_MS);
    last().message({ op: "rejected", reason: "invalid-ticket" });
    expect(sockets[0]?.closed).not.toBeNull();
    await timers.advance(0);
    expect(sockets).toHaveLength(2);
    link.stop();
  });

  it("即時通道停用(憑證 null)→ down,60 秒後再問;拿憑證失敗 → 退避", async () => {
    const { link, timers, sockets, statuses, fetches } = setup([
      null,
      new Error("network"),
    ]);
    link.start();
    await timers.advance(0);
    expect(statuses).toEqual(["down"]);
    expect(sockets).toHaveLength(0);
    await timers.advance(DISABLED_RETRY_MS);
    expect(fetches()).toBe(2);
    await timers.advance(RECONNECT_BACKOFF_MS[0] ?? 0);
    expect(sockets).toHaveLength(1);
    link.stop();
  });
});
