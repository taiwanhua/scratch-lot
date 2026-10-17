import { describe, expect, it } from "@jest/globals";

import { SIGNAL_COALESCE_WINDOW_MS, SignalCoalescer } from "./signal-coalescer";

function setup() {
  let now = 1_000_000;
  const coalescer = new SignalCoalescer(() => now);
  return {
    coalescer,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("高頻信號合併:只合併看板,同一頻道每 2 秒最多一次(前緣送、窗內丟)", () => {
  it("第一次照送;2 秒內再來丟棄;滿 2 秒再送", () => {
    const { coalescer, advance } = setup();
    const board = { type: "board" };
    expect(coalescer.select("t1", ["board:s1"], board)).toEqual(["board:s1"]);
    advance(500);
    expect(coalescer.select("t1", ["board:s1"], board)).toEqual([]);
    advance(SIGNAL_COALESCE_WINDOW_MS - 500);
    expect(coalescer.select("t1", ["board:s1"], board)).toEqual(["board:s1"]);
  });

  it("窗內的頻道丟棄、其他頻道照送;不同租戶各算各的", () => {
    const { coalescer, advance } = setup();
    const board = { type: "board" };
    coalescer.select("t1", ["board:s1"], board);
    advance(100);
    expect(coalescer.select("t1", ["board:s1", "board:s2"], board)).toEqual([
      "board:s2",
    ]);
    expect(coalescer.select("t2", ["board:s1"], board)).toEqual(["board:s1"]);
  });

  it("badge:*、notification 不合併:連續送照樣全送", () => {
    const { coalescer } = setup();
    for (const type of ["badge:apply-center", "notification", "print-job"]) {
      expect(coalescer.select("t1", ["user:a"], { type })).toEqual(["user:a"]);
      expect(coalescer.select("t1", ["user:a"], { type })).toEqual(["user:a"]);
    }
  });
});
