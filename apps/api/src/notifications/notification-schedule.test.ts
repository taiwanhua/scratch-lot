import { describe, expect, it } from "@jest/globals";

import {
  type NotificationSchedule,
  scheduleHitAt,
  validateSchedule,
} from "./notification-schedule";

const TAIPEI = "Asia/Taipei";
const NEW_YORK = "America/New_York";

const LICENSE: NotificationSchedule = {
  kind: "days-before",
  daysBefore: [30, 7, 0],
  time: "09:00",
};
const OVERDUE: NotificationSchedule = { kind: "daily-overdue", time: "09:00" };
const MONTHLY_3: NotificationSchedule = {
  kind: "monthly",
  dayOfMonth: 3,
  time: "09:00",
};
const MONTHLY_31: NotificationSchedule = {
  kind: "monthly",
  dayOfMonth: 31,
  time: "09:00",
};

const date = (text: string) => {
  const [year, month, day] = text.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
};

const hitOf = (
  schedule: NotificationSchedule,
  scheduledFor: string,
  timezone: string,
  target?: string,
) =>
  scheduleHitAt(schedule, {
    scheduledFor: new Date(scheduledFor),
    timezone,
    ...(target === undefined ? {} : { date: date(target) }),
  });

describe("提醒時間:這個時點該不該寄(scheduleHitAt)", () => {
  it.each([
    // 證照到期 12/31:前 30 / 7 / 0 天各命中一次(台北 09:00 = 01:00Z)
    [
      "前 30 天",
      "2026-12-01T01:00:00Z",
      { localDate: "2026-12-01", daysBefore: 30 },
    ],
    [
      "前 7 天",
      "2026-12-24T01:00:00Z",
      { localDate: "2026-12-24", daysBefore: 7 },
    ],
    [
      "當天",
      "2026-12-31T01:00:00Z",
      { localDate: "2026-12-31", daysBefore: 0 },
    ],
    ["前 29 天不寄", "2026-12-02T01:00:00Z", null],
    ["過期不再寄", "2027-01-01T01:00:00Z", null],
    ["同一天下一次排程不再寄", "2026-12-01T01:15:00Z", null],
    ["時間還沒到", "2026-12-01T00:45:00Z", null],
  ])("某日期前 N 天:%s", (_label, scheduledFor, expected) => {
    const hit = hitOf(LICENSE, scheduledFor, TAIPEI, "2026-12-31");
    if (expected === null) {
      expect(hit).toBeNull();
      return;
    }
    expect(hit).toEqual({ at: new Date(scheduledFor), ...expected });
  });

  it.each([
    ["逾期當天不寄", "2026-10-19T01:00:00Z", null],
    ["隔天起寄", "2026-10-20T01:00:00Z", "2026-10-20"],
    ["之後每天寄", "2026-10-25T01:00:00Z", "2026-10-25"],
    ["同一天其他時點不寄", "2026-10-25T05:00:00Z", null],
  ])("逾期後每天:%s", (_label, scheduledFor, localDate) => {
    const hit = hitOf(OVERDUE, scheduledFor, TAIPEI, "2026-10-19");
    expect(hit?.localDate ?? null).toBe(localDate);
  });

  it.each([
    ["每月第 3 天", MONTHLY_3, "2026-11-03T01:00:00Z", "2026-11-03"],
    ["第 4 天不寄", MONTHLY_3, "2026-11-04T01:00:00Z", null],
    [
      "選 31:2 月用月底(平年)",
      MONTHLY_31,
      "2027-02-28T01:00:00Z",
      "2027-02-28",
    ],
    [
      "選 31:2 月用月底(閏年)",
      MONTHLY_31,
      "2028-02-29T01:00:00Z",
      "2028-02-29",
    ],
    ["選 31:4 月是 4/30", MONTHLY_31, "2026-04-30T01:00:00Z", "2026-04-30"],
    ["選 31:5 月是 5/31", MONTHLY_31, "2026-05-31T01:00:00Z", "2026-05-31"],
    ["選 31:5/30 不寄", MONTHLY_31, "2026-05-30T01:00:00Z", null],
  ])("每月第 N 天:%s", (_label, schedule, scheduledFor, localDate) => {
    const hit = hitOf(schedule, scheduledFor, TAIPEI);
    expect(hit?.localDate ?? null).toBe(localDate);
  });

  it.each([
    ["紐約冬令 09:00 = 14:00Z", NEW_YORK, "2026-12-01T14:00:00Z", "2026-12-01"],
    ["同一刻在台北是 22:00,不寄", TAIPEI, "2026-12-01T14:00:00Z", null],
    ["紐約夏令 09:00 = 13:00Z", NEW_YORK, "2026-07-01T13:00:00Z", "2026-07-01"],
    ["紐約夏令 14:00Z 已是 10:00,不寄", NEW_YORK, "2026-07-01T14:00:00Z", null],
  ])("時區換算用租戶時區:%s", (_label, timezone, scheduledFor, localDate) => {
    const schedule: NotificationSchedule = {
      kind: "days-before",
      daysBefore: [0],
      time: "09:00",
    };
    const target = localDate ?? scheduledFor.slice(0, 10);
    const hit = hitOf(schedule, scheduledFor, timezone, target);
    expect(hit?.localDate ?? null).toBe(localDate);
  });

  it("當地 00:00 的時點落在前一個 UTC 日期,命中的仍是當地那天", () => {
    const schedule: NotificationSchedule = {
      kind: "days-before",
      daysBefore: [0],
      time: "00:00",
    };
    expect(
      hitOf(schedule, "2026-12-30T16:00:00Z", TAIPEI, "2026-12-31"),
    ).toEqual({
      at: new Date("2026-12-30T16:00:00Z"),
      localDate: "2026-12-31",
      daysBefore: 0,
    });
  });

  it("08:30 把 09:00 改成 08:00:今天不補寄、舊的 09:00 也不寄,明天起 08:00", () => {
    const changed: NotificationSchedule = {
      kind: "daily-overdue",
      time: "08:00",
    };
    const hits: string[] = [];
    // 改完之後的每一次排程:2026-12-01 08:30(台北)起到隔天 09:00
    const start = Date.parse("2026-12-01T00:30:00Z");
    const end = Date.parse("2026-12-02T01:00:00Z");
    for (let slot = start; slot <= end; slot += 15 * 60_000) {
      const hit = scheduleHitAt(changed, {
        scheduledFor: slot,
        timezone: TAIPEI,
        date: date("2026-11-20"),
      });
      if (hit !== null) {
        hits.push(hit.at.toISOString());
      }
    }
    expect(hits).toEqual(["2026-12-02T00:00:00.000Z"]);
  });

  it("days-before / daily-overdue 沒給日期 → 程式錯誤", () => {
    expect(() =>
      scheduleHitAt(LICENSE, {
        scheduledFor: Date.parse("2026-12-01T01:00:00Z"),
        timezone: TAIPEI,
      }),
    ).toThrow(TypeError);
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
