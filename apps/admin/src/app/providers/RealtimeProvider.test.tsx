import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";

import { useApplyCenterCountsQuery } from "@repo/graphql";

import {
  RealtimeContext,
  type RealtimeContextValue,
  useRealtimeBoard,
  useRealtimeSignal,
  useRealtimeStatus,
} from "@/hooks/base/useRealtime";
import { SessionContext } from "@/hooks/base/useSession";
import { createAuthSession } from "@/lib/base/auth/session";
import { composeRealtimeSignals } from "@/lib/base/realtime/signal-registry";
import { useSessionStore } from "@/stores/base/useSessionStore";
import { TEST_GRAPHQL_ENDPOINT } from "@/test/msw/server";
import {
  FakeSocket,
  ManualTimers,
  flushPromises,
  grantOf,
} from "@/test/realtime";

import {
  REALTIME_FOLLOW_UP_MS,
  REALTIME_POLL_INTERVAL_MS,
  RealtimeProvider,
} from "./RealtimeProvider";

const COUNTS_KEY = useApplyCenterCountsQuery.getKey();
const signals = composeRealtimeSignals(
  [{ type: "badge:apply-center", queryKeys: [COUNTS_KEY] }],
  [],
);

const Probe = ({ onBoard }: { onBoard: (type: string) => void }) => {
  const status = useRealtimeStatus();
  useRealtimeSignal("board", (signal) => {
    onBoard(signal.type);
  });
  return <span data-testid="status">{status}</span>;
};

const countsInvalidations = (invalidate: {
  mock: { calls: readonly (readonly unknown[])[] };
}) =>
  invalidate.mock.calls.filter(
    ([filters]) =>
      JSON.stringify((filters as { queryKey: unknown }).queryKey) ===
      JSON.stringify(COUNTS_KEY),
  ).length;

/** 重連一直失敗:第一條以外、還開著的連線全部被關掉。 */
const keepFailing = (sockets: readonly FakeSocket[]) => {
  for (const socket of sockets.slice(1)) {
    if (socket.closedWith === null) {
      socket.drop();
    }
  }
};

describe("RealtimeProvider", () => {
  let timers: ManualTimers;
  let sockets: FakeSocket[];
  let enabled: boolean;

  const latest = (): FakeSocket => {
    const socket = sockets.at(-1);
    if (socket === undefined) {
      throw new Error("還沒有連線");
    }
    return socket;
  };

  beforeEach(() => {
    timers = new ManualTimers();
    sockets = [];
    enabled = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const renderProvider = async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const onBoard = jest.fn<(type: string) => void>();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <SessionContext.Provider
          value={createAuthSession(TEST_GRAPHQL_ENDPOINT, useSessionStore)}
        >
          <RealtimeProvider
            signals={signals}
            connectionOptions={{
              timers,
              fetchTicket: () =>
                Promise.resolve(enabled ? grantOf(timers) : null),
              createSocket: (url) => {
                const socket = new FakeSocket(url);
                sockets.push(socket);
                return socket;
              },
            }}
          >
            <Probe onBoard={onBoard} />
          </RealtimeProvider>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
    // 等拿憑證的 promise 跑完
    await act(flushPromises);
    return { view, invalidate, onBoard };
  };

  it("收到登記的信號 → invalidate 對應的 query key;useRealtimeSignal 收到自己的類型", async () => {
    const { invalidate, onBoard } = await renderProvider();
    act(() => {
      latest().open();
    });
    expect(screen.getByTestId("status").textContent).toBe("live");
    act(() => {
      latest().receive({
        op: "signal",
        topic: "user:u1",
        signal: { type: "badge:apply-center" },
      });
      latest().receive({
        op: "signal",
        topic: "board:s1",
        signal: { type: "board" },
      });
    });
    expect(countsInvalidations(invalidate)).toBe(1);
    expect(onBoard).toHaveBeenCalledWith("board");
  });

  it("收到信號約 2.5 秒後再 invalidate 一次(補送出端 2 秒窗內丟掉的變動);窗內連續信號只補一次", async () => {
    const { invalidate } = await renderProvider();
    act(() => {
      latest().open();
    });
    const badge = {
      op: "signal",
      topic: "user:u1",
      signal: { type: "badge:apply-center" },
    };
    act(() => {
      latest().receive(badge);
    });
    await act(() => timers.advance(1000));
    act(() => {
      latest().receive(badge);
    });
    expect(countsInvalidations(invalidate)).toBe(2);
    await act(() => timers.advance(REALTIME_FOLLOW_UP_MS - 1000 - 1));
    expect(countsInvalidations(invalidate)).toBe(2);
    await act(() => timers.advance(1));
    expect(countsInvalidations(invalidate)).toBe(3);
    await act(() => timers.advance(REALTIME_FOLLOW_UP_MS * 2));
    expect(countsInvalidations(invalidate)).toBe(3);
  });

  it("連線中不輪詢", async () => {
    const { invalidate } = await renderProvider();
    act(() => {
      latest().open();
    });
    await act(() => timers.advance(REALTIME_POLL_INTERVAL_MS * 3));
    expect(countsInvalidations(invalidate)).toBe(0);
  });

  it("Worker 關掉(連不上)→ 每 60 秒輪詢一次,畫面資料照常更新", async () => {
    const { invalidate } = await renderProvider();
    act(() => {
      latest().drop();
    });
    expect(screen.getByTestId("status").textContent).toBe("slow");
    await act(async () => {
      await timers.advance(REALTIME_POLL_INTERVAL_MS - 1);
      keepFailing(sockets);
    });
    expect(countsInvalidations(invalidate)).toBe(0);
    await act(async () => {
      await timers.advance(1);
      keepFailing(sockets);
    });
    expect(countsInvalidations(invalidate)).toBe(1);
    await act(async () => {
      await timers.advance(REALTIME_POLL_INTERVAL_MS);
      keepFailing(sockets);
    });
    expect(countsInvalidations(invalidate)).toBe(2);
  });

  it("即時通道停用(憑證 null)→ 慢速模式輪詢", async () => {
    enabled = false;
    const { invalidate } = await renderProvider();
    expect(sockets).toHaveLength(0);
    expect(screen.getByTestId("status").textContent).toBe("slow");
    await act(() => timers.advance(REALTIME_POLL_INTERVAL_MS));
    expect(countsInvalidations(invalidate)).toBe(1);
  });

  it("斷線期間的變動在重連後補抓到:重新連上先 invalidate 一次,之後停止輪詢", async () => {
    const { invalidate } = await renderProvider();
    act(() => {
      latest().open();
    });
    act(() => {
      latest().drop();
    });
    // 退避 1 秒後重連
    await act(async () => {
      await timers.advance(1000);
    });
    expect(sockets).toHaveLength(2);
    expect(countsInvalidations(invalidate)).toBe(0);
    act(() => {
      latest().open();
    });
    expect(screen.getByTestId("status").textContent).toBe("live");
    expect(countsInvalidations(invalidate)).toBe(1);
    await act(() => timers.advance(REALTIME_POLL_INTERVAL_MS * 2));
    expect(countsInvalidations(invalidate)).toBe(1);
  });
});

describe("useRealtimeBoard", () => {
  const BoardPage = ({ orgId }: { orgId: string | null }) => {
    useRealtimeBoard("store-board", orgId);
    return null;
  };

  it("進入(先沒選店)→ 選 B → 換 C:直接換店、不經過 null;只有卸載時換回 null", () => {
    const setBoard = jest.fn<RealtimeContextValue["setBoard"]>();
    const value: RealtimeContextValue = {
      status: "live",
      listen: () => () => undefined,
      setBoard,
      refresh: () => undefined,
    };
    const wrap = (orgId: string | null) => (
      <RealtimeContext.Provider value={value}>
        <BoardPage orgId={orgId} />
      </RealtimeContext.Provider>
    );
    const view = render(wrap(null));
    view.rerender(wrap("B"));
    view.rerender(wrap("C"));
    expect(setBoard.mock.calls.map(([board]) => board)).toEqual([
      null,
      { key: "store-board", orgId: "B" },
      { key: "store-board", orgId: "C" },
    ]);
    view.unmount();
    expect(setBoard.mock.calls.at(-1)).toEqual([null]);
    expect(setBoard).toHaveBeenCalledTimes(4);
  });
});
