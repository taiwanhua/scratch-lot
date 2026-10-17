import { describe, expect, it } from "@jest/globals";

import { composeRealtimeSignals, signalQueryKeys } from "./signal-registry";

const SIDEBAR = ["SidebarBadges"];
const COUNTS = ["ApplyCenterCounts"];
const BOARD = ["Board"];

const table = composeRealtimeSignals(
  [
    { type: "badge:*", queryKeys: [SIDEBAR] },
    { type: "badge:apply-center", queryKeys: [COUNTS] },
  ],
  [{ type: "board", queryKeys: [BOARD] }],
);

describe("signalQueryKeys", () => {
  it("完全相同的類型 + 對得上的前綴登記都要 invalidate", () => {
    expect(signalQueryKeys(table, "badge:apply-center")).toEqual([
      COUNTS,
      SIDEBAR,
    ]);
  });

  it("只有前綴登記的類型(專案的 badge:<模組 key>)也收得到", () => {
    expect(signalQueryKeys(table, "badge:dealers")).toEqual([SIDEBAR]);
  });

  it("前綴不吃到別的類型;沒登記的類型什麼都不做", () => {
    expect(signalQueryKeys(table, "board")).toEqual([BOARD]);
    expect(signalQueryKeys(table, "badges")).toEqual([]);
    expect(signalQueryKeys(table, "notification")).toEqual([]);
  });

  it("前綴登記與完全相同的類型一樣不可重複", () => {
    expect(() =>
      composeRealtimeSignals(
        [{ type: "badge:*", queryKeys: [SIDEBAR] }],
        [{ type: "badge:*", queryKeys: [COUNTS] }],
      ),
    ).toThrow("即時信號類型重複登記:badge:*");
  });
});
