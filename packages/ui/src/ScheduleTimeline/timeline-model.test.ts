import { describe, expect, it } from "@jest/globals";

import { at, bar, group, vacancy } from "./schedule-timeline-story-data";
import {
  dayLanes,
  disabledRangesOfDay,
  groupsOfDay,
  isHourDisabled,
  startMinutesOf,
} from "./timeline-model";
import {
  DEFAULT_SCROLL_MINUTE,
  clipToDay,
  dayStartMs,
  formatClock,
  formatMinute,
  formatTimeRange,
  initialScrollMinute,
  pointAt,
} from "./timeline-time";

const D1 = "2026-11-04";
const D2 = "2026-11-05";

describe("initialScrollMinute(進入畫面自動捲動)", () => {
  it("有長條:捲到最早的長條前 1 小時", () => {
    const models = groupsOfDay(
      [
        group("a", D1, 10, 14, "上午場", "早", [
          bar("a1", D1, 9.5, 14, "王小明"),
        ]),
        group("b", D1, 13, 18, "晚場", "晚", [bar("b1", D1, 13, 18, "陳大文")]),
      ],
      D1,
    );

    // 最早的是 09:30 的長條(延伸出容器),前 1 小時 = 08:30
    expect(initialScrollMinute(startMinutesOf([models]))).toBe(8.5 * 60);
  });

  it("容器比裡面的長條早開始:以容器的開始為準;不早於 00:00", () => {
    const early = groupsOfDay(
      [group("a", D1, 7, 14, "上午場", "早", [bar("a1", D1, 9, 14, "王小明")])],
      D1,
    );
    const midnight = groupsOfDay(
      [group("n", D1, 0.5, 6, "夜間場", "夜", [vacancy("n1", "負責")])],
      D1,
    );

    expect(initialScrollMinute(startMinutesOf([early]))).toBe(6 * 60);
    expect(initialScrollMinute(startMinutesOf([midnight]))).toBe(0);
  });

  it("沒有資料:捲到 08:00", () => {
    expect(initialScrollMinute(startMinutesOf([[], []]))).toBe(
      DEFAULT_SCROLL_MINUTE,
    );
    expect(DEFAULT_SCROLL_MINUTE).toBe(8 * 60);
  });

  it("週模式取整週最早的時刻(各天的時刻比,不比日期)", () => {
    const day1 = groupsOfDay(
      [group("a", D1, 10, 14, "上午場", "早", [bar("a1", D1, 10, 14, "甲")])],
      D1,
    );
    const day2 = groupsOfDay(
      [group("b", D2, 7, 12, "上午場", "早", [bar("b1", D2, 7, 12, "乙")])],
      D2,
    );

    expect(initialScrollMinute(startMinutesOf([day1, day2]))).toBe(6 * 60);
  });
});

describe("跨午夜:兩天各一段", () => {
  it("當天畫到 24:00(→ 次日),次日從 00:00 接續(前日 →)", () => {
    const start = at(D1, 20);
    const end = at(D1, 26);

    expect(clipToDay(start, end, D1)).toEqual({
      startMinute: 20 * 60,
      endMinute: 24 * 60,
      fromPrevDay: false,
      toNextDay: true,
    });
    expect(clipToDay(start, end, D2)).toEqual({
      startMinute: 0,
      endMinute: 2 * 60,
      fromPrevDay: true,
      toNextDay: false,
    });
    expect(clipToDay(start, end, "2026-11-06")).toBeNull();
  });

  it("跨午夜的容器與長條在兩天都有一段", () => {
    const night = group("n", D1, 20, 26, "夜間場", "夜", [
      bar("n1", D1, 20, 26, "陳大文"),
    ]);

    const [first] = groupsOfDay([night], D1);
    const [second] = groupsOfDay([night], D2);

    expect(first?.slotModels[0]?.bar?.solid).toEqual({
      start: 20 * 60,
      end: 24 * 60,
    });
    expect(second?.slotModels[0]?.bar?.solid).toEqual({ start: 0, end: 120 });
    expect(second?.slotModels[0]?.bar?.span.fromPrevDay).toBe(true);
    // 午夜那一刀不是延伸段
    expect(first?.slotModels[0]?.bar?.after).toBeNull();
    expect(second?.slotModels[0]?.bar?.before).toBeNull();
  });
});

describe("長條的前段 / 後段延伸", () => {
  it("超出容器的時間拆成延伸段,和實線段相接", () => {
    const [model] = groupsOfDay(
      [
        group("a", D1, 8.5, 14.5, "上午場", "早", [
          bar("a1", D1, 7.5, 16, "王小明"),
          vacancy("a2", "協同"),
        ]),
      ],
      D1,
    );
    const parts = model?.slotModels[0]?.bar;

    expect(parts?.before).toEqual({ start: 7.5 * 60, end: 8.5 * 60 });
    expect(parts?.solid).toEqual({ start: 8.5 * 60, end: 14.5 * 60 });
    expect(parts?.after).toEqual({ start: 14.5 * 60, end: 16 * 60 });
    expect(model?.slotModels[1]).toMatchObject({ index: 1, bar: null });
    // 容器的條數 = 長條 + 缺額空位;延伸段算進佔用時間(日模式排列用)
    expect(model?.slots).toBe(2);
    expect(model?.occupied).toEqual({ start: 7.5 * 60, end: 16 * 60 });
  });
});

describe("dayLanes(日模式往下排)", () => {
  it("時間不重疊的共用一列,重疊的往下開新列;延伸段也不能蓋到別的容器", () => {
    const models = groupsOfDay(
      [
        group("early", D1, 8.5, 14.5, "上午場", "早", [
          bar("e", D1, 8.5, 14.5, "甲"),
        ]),
        group("late", D1, 14.5, 22, "晚場", "晚", [
          bar("l", D1, 14.5, 22, "乙"),
        ]),
        group("restock", D1, 9, 13, "加開場", "補", [
          bar("r", D1, 9, 13, "丙"),
        ]),
        // 容器 15–17 和加開場不重疊,但長條延伸到 13:00 之前 → 不能和加開場同列
        group("extra", D1, 15, 17, "臨時", "臨", [bar("x", D1, 12, 17, "丁")]),
      ],
      D1,
    );

    expect(dayLanes(models).map((lane) => lane.map((m) => m.id))).toEqual([
      ["early", "late"],
      ["restock"],
      ["extra"],
    ]);
  });
});

describe("不能操作的時間與回呼的點", () => {
  it("範圍裁到當天;碰到範圍的小時格不能點", () => {
    const ranges = disabledRangesOfDay(
      [{ start: at(D1, 18.5), end: at(D1, 30), label: "公休" }],
      D1,
    );

    expect(ranges).toEqual([{ start: 18.5 * 60, end: 24 * 60, label: "公休" }]);
    expect(isHourDisabled(17, ranges)).toBe(false);
    expect(isHourDisabled(18, ranges)).toBe(true);
    expect(
      disabledRangesOfDay([{ start: at(D1, 18.5), end: at(D1, 30) }], D2),
    ).toEqual([{ start: 0, end: 6 * 60, label: undefined }]);
  });

  it("點到的時間取那一小時格的開始", () => {
    const point = pointAt(D1, 14 * 60 + 37);

    expect(point.date).toBe(D1);
    expect(point.time).toBe("14:00");
    expect(point.at.getTime()).toBe(at(D1, 14));
    expect(formatMinute(24 * 60)).toBe("24:00");
  });
});

describe("時區:一天以 timezone 的 00:00 起算", () => {
  // 2026-11-04 10:00–14:00 東京時間(UTC+9)= 01:00–05:00 UTC
  const start = Date.UTC(2026, 10, 4, 1);
  const end = Date.UTC(2026, 10, 4, 5);

  it("長條落在時區當地的那一天、那幾點", () => {
    expect(clipToDay(start, end, D1, "Asia/Tokyo")).toEqual({
      startMinute: 10 * 60,
      endMinute: 14 * 60,
      fromPrevDay: false,
      toNextDay: false,
    });
    // 同一段時間在 UTC 是 01:00–05:00
    expect(clipToDay(start, end, D1, "UTC")).toMatchObject({
      startMinute: 60,
      endMinute: 5 * 60,
    });
  });

  it("點到的時點與時間文字用同一個時區", () => {
    const point = pointAt(D1, 10 * 60 + 20, "Asia/Tokyo");

    expect(point).toEqual({ date: D1, time: "10:00", at: new Date(start) });
    expect(formatTimeRange(start, end, "Asia/Tokyo")).toBe("10:00–14:00");
    expect(formatClock(start, "UTC")).toBe("01:00");
  });

  it("夏令時間開始那天只有 23 小時:位置以當天 00:00 起經過的時間算,整天的範圍畫到 23:00 為止(切換後的長條比牆上時間早一格,已知限制)", () => {
    const day = "2026-03-08";
    const dayStart = dayStartMs(day, "America/New_York");
    const nextStart = dayStartMs("2026-03-09", "America/New_York");

    expect(dayStart).toBe(Date.UTC(2026, 2, 8, 5));
    expect(nextStart).toBe(Date.UTC(2026, 2, 9, 4));
    expect(clipToDay(dayStart, nextStart, day, "America/New_York")).toEqual({
      startMinute: 0,
      endMinute: 23 * 60,
      fromPrevDay: false,
      toNextDay: false,
    });
  });

  it("容器、不能操作的範圍也照時區裁切", () => {
    const tokyo = group("t", D1, 0, 1, "東京場", "東", [], { start, end });

    expect(groupsOfDay([tokyo], D1, "Asia/Tokyo")[0]?.span).toMatchObject({
      startMinute: 10 * 60,
      endMinute: 14 * 60,
    });
    expect(disabledRangesOfDay([{ start, end }], D1, "Asia/Tokyo")).toEqual([
      { start: 10 * 60, end: 14 * 60, label: undefined },
    ]);
  });
});
