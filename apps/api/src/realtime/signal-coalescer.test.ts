import { describe, expect, it } from "@jest/globals";

import type { RealtimeSignal } from "@repo/domain/realtime";

import {
  type CoalescerClock,
  SIGNAL_COALESCE_WINDOW_MS,
  SignalCoalescer,
} from "./signal-coalescer";

interface Sent {
  hub: string;
  topics: readonly string[];
  signal: RealtimeSignal;
}

/** 手動推進的時鐘:`advance(ms)` 依時間順序執行到期的計時器。 */
function manualClock(): CoalescerClock & { advance(ms: number): void } {
  let now = 1_000_000;
  let timers: { at: number; callback: () => void }[] = [];
  return {
    now: () => now,
    schedule: (callback, delayMs) => {
      timers.push({ at: now + delayMs, callback });
    },
    advance: (ms) => {
      now += ms;
      const due = timers
        .filter((timer) => timer.at <= now)
        .toSorted((a, b) => a.at - b.at);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) {
        timer.callback();
      }
    },
  };
}

function setup() {
  const sent: Sent[] = [];
  const clock = manualClock();
  const coalescer = new SignalCoalescer((hub, topics, signal) => {
    sent.push({ hub, topics, signal });
    return Promise.resolve();
  }, clock);
  return { sent, clock, coalescer };
}

describe("高頻信號合併:同一頻道同一類型每 2 秒最多一次", () => {
  it("第一次立即送;多個頻道一次送出", async () => {
    const { sent, coalescer } = setup();
    await coalescer.submit("t1", ["user:a", "user:b"], { type: "board" });
    expect(sent).toEqual([
      { hub: "t1", topics: ["user:a", "user:b"], signal: { type: "board" } },
    ]);
  });

  it("2 秒內再來幾次都只在窗尾補一次(帶最後一次的信號)", async () => {
    const { sent, clock, coalescer } = setup();
    await coalescer.submit("t1", ["board:s1"], { type: "board", id: "1" });
    clock.advance(500);
    await coalescer.submit("t1", ["board:s1"], { type: "board", id: "2" });
    clock.advance(500);
    await coalescer.submit("t1", ["board:s1"], { type: "board", id: "3" });
    expect(sent).toHaveLength(1);
    clock.advance(SIGNAL_COALESCE_WINDOW_MS - 1000);
    expect(sent).toEqual([
      { hub: "t1", topics: ["board:s1"], signal: { type: "board", id: "1" } },
      { hub: "t1", topics: ["board:s1"], signal: { type: "board", id: "3" } },
    ]);
    // 窗尾補送也算一次送出:之後 2 秒內再來照樣合併
    clock.advance(100);
    await coalescer.submit("t1", ["board:s1"], { type: "board" });
    expect(sent).toHaveLength(2);
  });

  it("不同類型、不同頻道、不同租戶各算各的", async () => {
    const { sent, coalescer } = setup();
    await coalescer.submit("t1", ["user:a"], { type: "notification" });
    await coalescer.submit("t1", ["user:a"], { type: "badge:apply-center" });
    await coalescer.submit("t1", ["user:b"], { type: "notification" });
    await coalescer.submit("t2", ["user:a"], { type: "notification" });
    expect(sent).toHaveLength(4);
  });

  it("同一次送出裡,窗內的頻道延後、其他頻道照樣立即一起送", async () => {
    const { sent, clock, coalescer } = setup();
    await coalescer.submit("t1", ["user:a"], { type: "badge:x" });
    clock.advance(100);
    await coalescer.submit("t1", ["user:a", "user:b", "user:c"], {
      type: "badge:x",
    });
    expect(sent[1]).toEqual({
      hub: "t1",
      topics: ["user:b", "user:c"],
      signal: { type: "badge:x" },
    });
    clock.advance(SIGNAL_COALESCE_WINDOW_MS);
    expect(sent[2]).toEqual({
      hub: "t1",
      topics: ["user:a"],
      signal: { type: "badge:x" },
    });
  });

  it("滿 2 秒後再來 → 立即送", async () => {
    const { sent, clock, coalescer } = setup();
    await coalescer.submit("t1", ["user:a"], { type: "notification" });
    clock.advance(SIGNAL_COALESCE_WINDOW_MS);
    await coalescer.submit("t1", ["user:a"], { type: "notification" });
    expect(sent).toHaveLength(2);
  });
});
