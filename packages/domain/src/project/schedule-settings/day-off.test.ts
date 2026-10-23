import { describe, expect, it } from "@jest/globals";

import { dayOffSlotsCoverDay } from "./index";

const HOUR = 3_600_000;
const range = (from: number, to: number) => ({
  startAt: from * HOUR,
  endAt: to * HOUR,
});

describe("時段不可排蓋滿整天(dayOffSlotsCoverDay)", () => {
  const day = range(0, 24);

  it.each([
    ["一段 00:00–隔天 00:00", [range(0, 24)]],
    ["相接的兩段", [range(12, 24), range(0, 12)]],
    ["重疊的兩段", [range(0, 13), range(11, 24)]],
    ["三段,有一段被包在裡面", [range(0, 10), range(2, 3), range(9, 24)]],
  ])("%s → 整天", (_label, slots) => {
    expect(dayOffSlotsCoverDay(slots, day)).toBe(true);
  });

  it.each([
    ["沒有段落", []],
    [
      "差一分鐘",
      [range(0, 12), { startAt: 12 * HOUR + 60_000, endAt: 24 * HOUR }],
    ],
    ["沒做到隔天 00:00", [range(0, 23)]],
    ["不是從 00:00 開始", [range(1, 24)]],
    ["開始不早於結束的段落不算", [range(0, 12), range(24, 12)]],
  ])("%s → 不是整天", (_label, slots) => {
    expect(dayOffSlotsCoverDay(slots, day)).toBe(false);
  });

  it("夏令時間切換日(23 / 25 小時)以時點比", () => {
    expect(dayOffSlotsCoverDay([range(0, 2), range(2, 23)], range(0, 23))).toBe(
      true,
    );
    expect(dayOffSlotsCoverDay([range(0, 24)], range(0, 25))).toBe(false);
    expect(
      dayOffSlotsCoverDay([range(0, 12), range(12, 25)], range(0, 25)),
    ).toBe(true);
  });
});
