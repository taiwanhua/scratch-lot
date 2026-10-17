import { describe, expect, it } from "@jest/globals";

import {
  DAILY_CATCH_UP_MS,
  dailySlotOf,
  intervalSlotOf,
  parseSchedule,
} from "./schedule";
import {
  ScheduledJobRegistrationError,
  ScheduledJobRegistry,
} from "./scheduled-job-registry";

const at = (iso: string) => Date.parse(iso);
const iso = (instant: number | null) =>
  instant === null ? null : new Date(instant).toISOString();
const EIGHT = { hour: 8, minute: 0 };
const noop = (): Promise<void> => Promise.resolve();

describe("parseSchedule", () => {
  it("認得 15m、1h、daily@HH:mm", () => {
    expect(parseSchedule("15m")).toEqual({
      kind: "interval",
      intervalMs: 900_000,
    });
    expect(parseSchedule("1h")).toEqual({
      kind: "interval",
      intervalMs: 3_600_000,
    });
    expect(parseSchedule("daily@08:00")).toEqual({
      kind: "daily",
      hour: 8,
      minute: 0,
    });
    expect(parseSchedule("daily@23:59")).toEqual({
      kind: "daily",
      hour: 23,
      minute: 59,
    });
  });

  it("其他寫法一律不認得", () => {
    for (const every of [
      "5m",
      "2h",
      "daily@8:00",
      "daily@24:00",
      "daily@08:60",
      "daily",
      "",
    ]) {
      expect(parseSchedule(every)).toBeNull();
    }
  });
});

describe("intervalSlotOf", () => {
  it("15m 對齊 :00 / :15 / :30 / :45,同一區間同一個時點", () => {
    const fifteen = 900_000;
    expect(iso(intervalSlotOf(fifteen, at("2030-01-01T10:15:00Z")))).toBe(
      "2030-01-01T10:15:00.000Z",
    );
    expect(iso(intervalSlotOf(fifteen, at("2030-01-01T10:29:59Z")))).toBe(
      "2030-01-01T10:15:00.000Z",
    );
    expect(iso(intervalSlotOf(3_600_000, at("2030-01-01T10:59:00Z")))).toBe(
      "2030-01-01T10:00:00.000Z",
    );
  });
});

describe("dailySlotOf:租戶當地 HH:mm", () => {
  it("台北 08:00 = UTC 00:00;紐約冬令 08:00 = UTC 13:00、夏令 = 12:00", () => {
    expect(
      iso(dailySlotOf(EIGHT, at("2030-03-01T00:05:00Z"), "Asia/Taipei")),
    ).toBe("2030-03-01T00:00:00.000Z");
    expect(
      iso(dailySlotOf(EIGHT, at("2030-03-01T13:05:00Z"), "America/New_York")),
    ).toBe("2030-03-01T13:00:00.000Z");
    expect(
      iso(dailySlotOf(EIGHT, at("2030-07-01T12:05:00Z"), "America/New_York")),
    ).toBe("2030-07-01T12:00:00.000Z");
  });

  it("還沒到當地 08:00 → 不到期(不會把昨天的補跑)", () => {
    expect(
      dailySlotOf(EIGHT, at("2030-02-28T23:50:00Z"), "Asia/Taipei"),
    ).toBeNull();
  });

  it("補跑窗內錯過的呼叫仍會到期,超過就等下一天", () => {
    const slot = at("2030-03-01T00:00:00Z");
    expect(
      dailySlotOf(EIGHT, slot + DAILY_CATCH_UP_MS - 1, "Asia/Taipei"),
    ).toBe(slot);
    expect(
      dailySlotOf(EIGHT, slot + DAILY_CATCH_UP_MS, "Asia/Taipei"),
    ).toBeNull();
  });

  it("午夜前後的時刻:daily@23:30 在當地隔天 00:10 仍算前一天的那一次", () => {
    expect(
      iso(
        dailySlotOf(
          { hour: 23, minute: 30 },
          at("2030-03-01T16:10:00Z"),
          "Asia/Taipei",
        ),
      ),
    ).toBe("2030-03-01T15:30:00.000Z");
  });
});

describe("ScheduledJobRegistry", () => {
  it("key 重複、空白、頻率不認得 → 拋 ScheduledJobRegistrationError", () => {
    const registry = new ScheduledJobRegistry();
    registry.registerScheduledJob({ key: "a", every: "15m", handler: noop });
    expect(() => {
      registry.registerScheduledJob({ key: "a", every: "1h", handler: noop });
    }).toThrow(ScheduledJobRegistrationError);
    expect(() => {
      registry.registerScheduledJob({ key: " ", every: "1h", handler: noop });
    }).toThrow(ScheduledJobRegistrationError);
    expect(() => {
      registry.registerScheduledJob({
        key: "b",
        every: "daily@8am",
        handler: noop,
      });
    }).toThrow(ScheduledJobRegistrationError);
    expect(registry.jobs().map((job) => job.key)).toEqual(["a"]);
  });
});
