import { describe, expect, it } from "@jest/globals";

import {
  completeSlots,
  dayKeyOf,
  dayOffBandOf,
  dayOffCountTone,
  isCompleteSlot,
  isPastDayOffMonth,
  monthRangeOf,
  slotInstantsOf,
  slotsCoverWholeDay,
} from "./schedule-day-offs";

const TAIPEI = "Asia/Taipei";
const taipei = (date: string, time = "00:00") =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

describe("畫休畫面的換算", () => {
  it.each([
    [1, 2, "grey"],
    [2, 2, "warning"],
    [3, 2, "error"],
    [5, null, "grey"],
  ] as const)(
    "同日畫休 %i/%s → %s(未滿灰、滿了橘、超過紅)",
    (count, limit, tone) => {
      expect(dayOffCountTone(count, limit)).toBe(tone);
    },
  );

  it("色帶取那天最嚴重的等級(違反的日期是時點,以租戶時區的日期對格子)", () => {
    const violations = [
      {
        key: "a",
        level: "reminder",
        dates: [taipei("2026-12-13"), taipei("2026-12-14")],
      },
      { key: "b", level: "limit", dates: [taipei("2026-12-14")] },
    ];
    expect(dayOffBandOf(violations, "2026-12-13", TAIPEI)).toBe("reminder");
    expect(dayOffBandOf(violations, "2026-12-14", TAIPEI)).toBe("limit");
    expect(dayOffBandOf(violations, "2026-12-15", TAIPEI)).toBeNull();
  });

  it("時段:全空的段略過;填一半或開始不早於結束 → null", () => {
    expect(
      completeSlots([
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "", endTime: "" },
      ]),
    ).toEqual([{ startTime: "09:00", endTime: "12:00" }]);
    expect(completeSlots([{ startTime: "09:00", endTime: "" }])).toBeNull();
    expect(
      completeSlots([{ startTime: "13:00", endTime: "09:00" }]),
    ).toBeNull();
    expect(completeSlots([{ startTime: "", endTime: "" }])).toBeNull();
    // 結束 00:00 = 隔天 00:00(做到當天結束):任何開始都早於它
    expect(completeSlots([{ startTime: "22:00", endTime: "00:00" }])).toEqual([
      { startTime: "22:00", endTime: "00:00" },
    ]);
    expect(isCompleteSlot({ startTime: "00:00", endTime: "00:00" })).toBe(true);
    // 其他「結束不晚於開始」不算隔天(時段不往後跨)
    expect(isCompleteSlot({ startTime: "22:00", endTime: "02:00" })).toBe(
      false,
    );
  });

  it("幾段合起來蓋滿整天(一段 00:00–00:00、相接、重疊)要改選整天畫休", () => {
    const covers = (slots: { startTime: string; endTime: string }[]) =>
      slotsCoverWholeDay(slots, "2026-12-10", TAIPEI);
    expect(covers([{ startTime: "00:00", endTime: "00:00" }])).toBe(true);
    expect(
      covers([
        { startTime: "12:00", endTime: "00:00" },
        { startTime: "00:00", endTime: "12:00" },
      ]),
    ).toBe(true);
    expect(
      covers([
        { startTime: "00:00", endTime: "13:00" },
        { startTime: "11:00", endTime: "00:00" },
      ]),
    ).toBe(true);
    // 差一分鐘、沒從 00:00 開始、沒做到當天結束、還沒填完的段落不算
    expect(
      covers([
        { startTime: "00:00", endTime: "12:00" },
        { startTime: "12:01", endTime: "00:00" },
      ]),
    ).toBe(false);
    expect(covers([{ startTime: "00:01", endTime: "00:00" }])).toBe(false);
    expect(covers([{ startTime: "00:00", endTime: "23:59" }])).toBe(false);
    expect(
      covers([
        { startTime: "00:00", endTime: "12:00" },
        { startTime: "12:00", endTime: "" },
      ]),
    ).toBe(false);
    expect(covers([{ startTime: "", endTime: "" }])).toBe(false);
    // 還沒選日期:照牆上時間 00:00–24:00 判斷
    expect(
      slotsCoverWholeDay(
        [{ startTime: "00:00", endTime: "00:00" }],
        "",
        TAIPEI,
      ),
    ).toBe(true);
  });

  it("整天以租戶時區那天的長度判斷(洛杉磯夏令時間開始那天只有 23 小時)", () => {
    const la = "America/Los_Angeles";
    // 2027-03-14 02:00 跳到 03:00:00:00–02:00 + 03:00–00:00 中間沒有空檔,是整天
    expect(
      slotsCoverWholeDay(
        [
          { startTime: "00:00", endTime: "02:00" },
          { startTime: "03:00", endTime: "00:00" },
        ],
        "2027-03-14",
        la,
      ),
    ).toBe(true);
    // 平常的日子 02:00–03:00 是空檔
    expect(
      slotsCoverWholeDay(
        [
          { startTime: "00:00", endTime: "02:00" },
          { startTime: "03:00", endTime: "00:00" },
        ],
        "2027-03-15",
        la,
      ),
    ).toBe(false);
    // 夏令時間結束那天(25 小時)一樣是 00:00–00:00 才整天
    expect(
      slotsCoverWholeDay(
        [{ startTime: "00:00", endTime: "00:00" }],
        "2026-11-01",
        la,
      ),
    ).toBe(true);
    expect(
      slotsCoverWholeDay(
        [{ startTime: "00:00", endTime: "23:00" }],
        "2026-11-01",
        la,
      ),
    ).toBe(false);
  });

  it("時段結束 00:00 合成隔天 00:00(租戶時區)", () => {
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "22:00", endTime: "00:00" }],
        TAIPEI,
      ),
    ).toEqual([
      {
        startAt: taipei("2026-12-10", "22:00"),
        endAt: taipei("2026-12-11", "00:00"),
      },
    ]);
    // 洛杉磯 12/11 00:00 = UTC 12/11 08:00
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "22:00", endTime: "00:00" }],
        "America/Los_Angeles",
      ),
    ).toEqual([
      {
        startAt: "2026-12-11T06:00:00.000Z",
        endAt: "2026-12-11T08:00:00.000Z",
      },
    ]);
  });

  it("時點 ↔ 日期鍵、月份的時點區間(租戶時區不是台北時也對)", () => {
    // 台北 12/3 00:00 = UTC 12/2 16:00
    expect(dayKeyOf(taipei("2026-12-03"), TAIPEI)).toBe("2026-12-03");
    expect(dayKeyOf(taipei("2026-12-03"), "UTC")).toBe("2026-12-02");
    expect(dayKeyOf("not-a-date", TAIPEI)).toBe("");
    expect(monthRangeOf("2026-12", TAIPEI)).toEqual({
      from: taipei("2026-12-01"),
      to: taipei("2027-01-01"),
    });
    // 洛杉磯 12 月是 UTC−8
    expect(monthRangeOf("2026-12", "America/Los_Angeles")).toEqual({
      from: "2026-12-01T08:00:00.000Z",
      to: "2027-01-01T08:00:00.000Z",
    });
    expect(monthRangeOf("2026-13", TAIPEI)).toBeNull();
  });

  it("時段:那天的 HH:mm 以租戶時區合成時點;不合法 → null", () => {
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "09:00", endTime: "13:00" }],
        TAIPEI,
      ),
    ).toEqual([
      {
        startAt: taipei("2026-12-10", "09:00"),
        endAt: taipei("2026-12-10", "13:00"),
      },
    ]);
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "09:00", endTime: "13:00" }],
        "America/Los_Angeles",
      ),
    ).toEqual([
      {
        startAt: "2026-12-10T17:00:00.000Z",
        endAt: "2026-12-10T21:00:00.000Z",
      },
    ]);
    expect(
      slotInstantsOf(
        "2026-12-10",
        [{ startTime: "9:00", endTime: "13:00" }],
        TAIPEI,
      ),
    ).toBeNull();
    expect(
      slotInstantsOf("", [{ startTime: "09:00", endTime: "13:00" }], TAIPEI),
    ).toBeNull();
  });

  it.each([
    ["2026-12", false], // 目標月
    ["2026-11", false], // 這個月
    ["2026-10", true], // 上個月
    ["2025-03", true], // 更早
  ] as const)("目標月 2026-12:%s → 過去的月份 %s", (month, past) => {
    expect(isPastDayOffMonth(month, "2026-12")).toBe(past);
  });

  it("跨年:目標月 2027-01 的這個月是 2026-12,2026-11 才算過去", () => {
    expect(isPastDayOffMonth("2026-12", "2027-01")).toBe(false);
    expect(isPastDayOffMonth("2026-11", "2027-01")).toBe(true);
  });
});
