import { describe, expect, it } from "@jest/globals";

import { SCHEDULE_TIME_OPTIONS, validateSchedule } from "./schedule";

describe("寄送時間選項", () => {
  it("15 分鐘一格:00:00 … 23:45,共 96 個", () => {
    expect(SCHEDULE_TIME_OPTIONS).toHaveLength(96);
    expect(SCHEDULE_TIME_OPTIONS[0]).toBe("00:00");
    expect(SCHEDULE_TIME_OPTIONS.at(-1)).toBe("23:45");
    expect(SCHEDULE_TIME_OPTIONS).not.toContain("09:10");
  });
});

describe("提醒時間的驗證(validateSchedule)", () => {
  it.each([
    ["提前天數 366", { daysBefore: [366], time: "09:00" }, "daysBefore[0]"],
    ["負數", { daysBefore: [-1], time: "09:00" }, "daysBefore[0]"],
    ["小數", { daysBefore: [1.5], time: "09:00" }, "daysBefore[0]"],
    [
      "第 6 個",
      { daysBefore: [1, 2, 3, 4, 5, 6], time: "09:00" },
      "daysBefore[5]",
    ],
    ["重複", { daysBefore: [7, 30, 7], time: "09:00" }, "daysBefore[2]"],
    ["一個都沒有", { daysBefore: [], time: "09:00" }, "daysBefore"],
    ["09:10 不在 15 分鐘格子", { daysBefore: [0], time: "09:10" }, "time"],
    ["24:00", { daysBefore: [0], time: "24:00" }, "time"],
    [
      "多出的欄位",
      { daysBefore: [0], time: "09:00", dayOfMonth: 3 },
      "dayOfMonth",
    ],
  ])("某日期前 N 天:%s → 擋下", (_label, value, path) => {
    const result = validateSchedule(
      { kind: "days-before", ...value },
      "days-before",
    );
    expect(result.ok ? null : result.issue.path).toBe(path);
  });

  it("某日期前 N 天:0–365、最多 5 個、不重複、15 分鐘一格 → 通過", () => {
    expect(
      validateSchedule(
        { kind: "days-before", daysBefore: [365, 60, 7, 1, 0], time: "23:45" },
        "days-before",
      ),
    ).toEqual({
      ok: true,
      schedule: {
        kind: "days-before",
        daysBefore: [365, 60, 7, 1, 0],
        time: "23:45",
      },
    });
  });

  it.each([
    ["第 0 天", 0, false],
    ["第 1 天", 1, true],
    ["第 31 天", 31, true],
    ["第 32 天", 32, false],
  ])("每月第 N 天:%s", (_label, dayOfMonth, ok) => {
    expect(
      validateSchedule(
        { kind: "monthly", dayOfMonth, time: "09:00" },
        "monthly",
      ).ok,
    ).toBe(ok);
  });

  it("寫法必須是類型宣告的那一種", () => {
    const result = validateSchedule(
      { kind: "monthly", dayOfMonth: 3, time: "09:00" },
      "daily-overdue",
    );
    expect(result.ok ? null : result.issue.path).toBe("kind");
  });
});
