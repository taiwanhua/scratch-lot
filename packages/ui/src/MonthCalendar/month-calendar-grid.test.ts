import { describe, expect, it } from "@jest/globals";

import {
  buildMonthWeeks,
  selectableDatesOf,
  shiftMonth,
  toggleDaySelection,
  toggleWeekSelection,
  weekSelectionState,
} from "./month-calendar-grid";

describe("buildMonthWeeks", () => {
  it("一週從星期日開始,前後補上 / 下個月的日子湊滿整週", () => {
    const weeks = buildMonthWeeks("2026-10");

    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toEqual({
      date: "2026-09-27",
      day: 27,
      inMonth: false,
    });
    expect(weeks[0]?.[4]).toEqual({
      date: "2026-10-01",
      day: 1,
      inMonth: true,
    });
    expect(weeks.at(-1)?.at(-1)).toEqual({
      date: "2026-10-31",
      day: 31,
      inMonth: true,
    });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("剛好從星期日開始、四週排滿的月份不補日子", () => {
    const weeks = buildMonthWeeks("2026-02");

    expect(weeks).toHaveLength(4);
    expect(weeks.flat().every((day) => day.inMonth)).toBe(true);
  });

  it("需要六週的月份排出六週", () => {
    expect(buildMonthWeeks("2026-08")).toHaveLength(6);
  });
});

describe("shiftMonth", () => {
  it("跨年換月", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

/** 10/2 停用 */
const isDisabled = (date: string) => date === "2026-10-02";

describe("整週選取", () => {
  const week = buildMonthWeeks("2026-10")[0] ?? [];

  it("可選的日子排除上個月與停用日", () => {
    expect(selectableDatesOf(week, isDisabled)).toEqual([
      "2026-10-01",
      "2026-10-03",
    ]);
  });

  it("勾選框狀態:沒選 / 半選 / 全選 / 沒有可選的日子", () => {
    const selectable = ["2026-10-01", "2026-10-03"];
    expect(weekSelectionState(selectable, new Set())).toBe("none");
    expect(weekSelectionState(selectable, new Set(["2026-10-01"]))).toBe(
      "some",
    );
    expect(weekSelectionState(selectable, new Set(selectable))).toBe("all");
    expect(weekSelectionState([], new Set())).toBe("disabled");
  });

  it("沒全選 → 全選;全選 → 全部取消;其他週的選取保留", () => {
    const selectable = ["2026-10-01", "2026-10-03"];
    expect(
      toggleWeekSelection(["2026-10-20", "2026-10-01"], selectable),
    ).toEqual(["2026-10-01", "2026-10-03", "2026-10-20"]);
    expect(
      toggleWeekSelection(
        ["2026-10-01", "2026-10-03", "2026-10-20"],
        selectable,
      ),
    ).toEqual(["2026-10-20"]);
  });

  it("點一天切換那一天", () => {
    expect(toggleDaySelection(["2026-10-05"], "2026-10-05")).toEqual([]);
    expect(toggleDaySelection(["2026-10-05"], "2026-10-01")).toEqual([
      "2026-10-01",
      "2026-10-05",
    ]);
  });
});
