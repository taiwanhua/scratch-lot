import { describe, expect, it } from "@jest/globals";

import type { NotificationSchedule } from "@repo/domain/notification-schedule";

import { scheduleHitAt } from "./notification-schedule";

const TAIPEI = "Asia/Taipei";
const NEW_YORK = "America/New_York";

const EXPIRY: NotificationSchedule = {
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
  modifiedAt?: string,
) =>
  scheduleHitAt(schedule, {
    scheduledFor: new Date(scheduledFor),
    timezone,
    ...(target === undefined ? {} : { date: date(target) }),
    ...(modifiedAt === undefined ? {} : { modifiedAt: new Date(modifiedAt) }),
  });

/** 命中的時點識別(`dedupeKey` 用);沒命中 = null。 */
const occurrenceOf = (...args: Parameters<typeof hitOf>) =>
  hitOf(...args)?.occurrence ?? null;

describe("提醒時間:這個時點該不該寄(scheduleHitAt)", () => {
  it.each([
    // 到期日 12/31:前 30 / 7 / 0 天各自一個時點(台北 09:00 = 01:00Z)
    ["前 30 天", "2026-12-01T01:00:00Z", "2026-12-01#d30"],
    ["前 7 天", "2026-12-24T01:00:00Z", "2026-12-24#d7"],
    ["當天", "2026-12-31T01:00:00Z", "2026-12-31#d0"],
    ["前 29 天不寄", "2026-12-02T01:00:00Z", null],
    ["過期不再寄", "2027-01-01T01:00:00Z", null],
    ["時間還沒到", "2026-12-01T00:45:00Z", null],
  ])("某日期前 N 天:%s", (_label, scheduledFor, occurrence) => {
    expect(occurrenceOf(EXPIRY, scheduledFor, TAIPEI, "2026-12-31")).toBe(
      occurrence,
    );
  });

  it("某日期前 N 天:30 / 7 / 0 各自獨立,回傳應寄時點與前幾天", () => {
    expect(hitOf(EXPIRY, "2026-12-24T01:00:00Z", TAIPEI, "2026-12-31")).toEqual(
      {
        at: new Date("2026-12-24T01:00:00Z"),
        localDate: "2026-12-24",
        daysBefore: 7,
        occurrence: "2026-12-24#d7",
      },
    );
    const keys = [
      "2026-12-01T01:00:00Z",
      "2026-12-24T01:00:00Z",
      "2026-12-31T01:00:00Z",
    ].map((slot) => occurrenceOf(EXPIRY, slot, TAIPEI, "2026-12-31"));
    expect(new Set(keys).size).toBe(3);
  });

  it.each([
    ["準時 09:00", "2026-12-01T01:00:00Z", "2026-12-01#d30"],
    [
      "09:00 漏跑,09:15 補寄同一個時點",
      "2026-12-01T01:15:00Z",
      "2026-12-01#d30",
    ],
    // 09:30 再叫到仍回同一個時點 → 同一個 dedupeKey,notify() 不重寄
    [
      "09:30 再叫到:同一個時點(不重寄)",
      "2026-12-01T01:30:00Z",
      "2026-12-01#d30",
    ],
    ["14:45 仍在 6 小時內", "2026-12-01T06:45:00Z", "2026-12-01#d30"],
    ["15:00 超過 6 小時就放棄", "2026-12-01T07:00:00Z", null],
  ])("漏跑補寄(6 小時內):%s", (_label, scheduledFor, occurrence) => {
    expect(occurrenceOf(EXPIRY, scheduledFor, TAIPEI, "2026-12-31")).toBe(
      occurrence,
    );
  });

  it.each([
    ["逾期當天不寄", "2026-10-19T01:00:00Z", null],
    ["隔天起寄", "2026-10-20T01:00:00Z", "2026-10-20"],
    ["之後每天寄", "2026-10-25T01:00:00Z", "2026-10-25"],
    [
      "當天 08:45 只看得到前一天的時點(超過 6 小時)→ 不寄",
      "2026-10-25T00:45:00Z",
      null,
    ],
  ])("逾期後每天:%s", (_label, scheduledFor, occurrence) => {
    expect(occurrenceOf(OVERDUE, scheduledFor, TAIPEI, "2026-10-19")).toBe(
      occurrence,
    );
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
  ])("每月第 N 天:%s", (_label, schedule, scheduledFor, occurrence) => {
    expect(occurrenceOf(schedule, scheduledFor, TAIPEI)).toBe(occurrence);
  });

  it.each([
    ["紐約冬令 09:00 = 14:00Z", NEW_YORK, "2026-12-01T14:00:00Z", "2026-12-01"],
    [
      "同一刻在台北是 22:00(09:00 已過 13 小時),不寄",
      TAIPEI,
      "2026-12-01T14:00:00Z",
      null,
    ],
    ["紐約夏令 09:00 = 13:00Z", NEW_YORK, "2026-07-01T13:00:00Z", "2026-07-01"],
    ["紐約夏令 08:45(12:45Z)還沒到", NEW_YORK, "2026-07-01T12:45:00Z", null],
  ])("時區換算用租戶時區:%s", (_label, timezone, scheduledFor, localDate) => {
    const hit = hitOf(OVERDUE, scheduledFor, timezone, "2026-01-01");
    expect(hit?.localDate ?? null).toBe(localDate);
  });

  it("當地 00:00 的時點落在前一個 UTC 日期,命中的仍是當地那天", () => {
    const schedule: NotificationSchedule = {
      kind: "days-before",
      daysBefore: [0],
      time: "00:00",
    };
    expect(
      hitOf(schedule, "2026-12-30T16:00:00Z", TAIPEI, "2026-12-31")?.occurrence,
    ).toBe("2026-12-31#d0");
  });

  it.each([
    // 08:45 把 09:00 改成 08:30:今天 08:30 早於修改時間 → 不補
    ["今天 08:30 早於修改時間,不補", "2026-12-01T01:00:00Z", null],
    ["今天 09:00(舊時點)也不寄", "2026-12-01T01:15:00Z", null],
    ["明天起 08:30", "2026-12-02T00:30:00Z", "2026-12-02"],
  ])("改了時間(修改時間 08:45):%s", (_label, scheduledFor, occurrence) => {
    const changed: NotificationSchedule = {
      kind: "daily-overdue",
      time: "08:30",
    };
    expect(
      occurrenceOf(
        changed,
        scheduledFor,
        TAIPEI,
        "2026-11-20",
        "2026-12-01T00:45:00Z",
      ),
    ).toBe(occurrence);
  });

  it("08:30 把 09:00 改成 08:00:之後每一次排程都不補今天,明天起 08:00", () => {
    const changed: NotificationSchedule = {
      kind: "daily-overdue",
      time: "08:00",
    };
    const occurrences = new Set<string>();
    const start = Date.parse("2026-12-01T00:30:00Z");
    const end = Date.parse("2026-12-02T01:00:00Z");
    for (let slot = start; slot <= end; slot += 15 * 60_000) {
      const hit = scheduleHitAt(changed, {
        scheduledFor: slot,
        timezone: TAIPEI,
        date: date("2026-11-20"),
        modifiedAt: start,
      });
      if (hit !== null) {
        occurrences.add(hit.occurrence);
      }
    }
    expect([...occurrences]).toEqual(["2026-12-02"]);
  });

  it("days-before / daily-overdue 沒給日期 → 程式錯誤", () => {
    expect(() =>
      scheduleHitAt(EXPIRY, {
        scheduledFor: Date.parse("2026-12-01T01:00:00Z"),
        timezone: TAIPEI,
      }),
    ).toThrow(TypeError);
  });
});
