import { describe, expect, it } from "@jest/globals";

import type { ScheduleRuleLevel } from "@repo/domain/project/schedule-settings";

import type { EffectiveRuleSetting } from "../rules/rule-registry";
import {
  type BusyLike,
  type UnderstaffedDemandLike,
  type WorkEntryLike,
  limitSeverityByKey,
  maxConsecutiveWorkDaysEvaluator,
  maxDailyWorkHoursEvaluator,
  minRestBetweenShiftsEvaluator,
  multiPositionOverlapEvaluator,
  understaffedEvaluator,
} from "./roster-rules";

const setting = (
  key: string,
  amount: number | null,
  level: ScheduleRuleLevel = "reminder",
  enabled = true,
): EffectiveRuleSetting => ({
  key,
  enabled,
  value: amount === null ? {} : { amount },
  level,
  order: 1,
});

/** 台北時間 → Date。 */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

let sequence = 0;
const entry = (
  date: string,
  start: string,
  end: string,
  options: {
    userId?: string;
    orgId?: string;
    breakMinutes?: number;
    endDate?: string;
    demands?: WorkEntryLike["demands"];
  } = {},
): WorkEntryLike => {
  sequence += 1;
  return {
    id: `e${String(sequence)}`,
    userId: options.userId ?? "u1",
    orgId: options.orgId ?? "store-a",
    date,
    startAt: at(date, start),
    endAt: at(options.endDate ?? date, end),
    breakMinutes: options.breakMinutes ?? 0,
    demands: options.demands ?? [],
  };
};

const person = (entries: WorkEntryLike[], month = "2026-11") => ({
  tenantId: "t",
  orgId: "store-a",
  data: { userId: "u1", month, entries },
});

const days = (from: number, count: number, month = "2026-11") =>
  Array.from({ length: count }, (_, index) =>
    entry(
      `${month}-${String(from + index).padStart(2, "0")}`,
      "09:00",
      "13:00",
    ),
  );

const demands = (
  date: string,
  windows: [string, string][],
): WorkEntryLike["demands"] =>
  windows.map(([start, end], index) => ({
    demandId: `d${String(index)}`,
    startAt: at(date, start),
    endAt: at(date, end),
  }));

const demand = (
  tasks: UnderstaffedDemandLike["tasks"],
): UnderstaffedDemandLike => ({
  id: "d1",
  date: "2026-11-05",
  startAt: at("2026-11-05", "14:30"),
  endAt: at("2026-11-05", "22:00"),
  tasks,
});

describe("每天最多上班時數(規格 14.2:同一天所有排班加總,跨午夜算開始那天)", () => {
  const rule = setting("maxDailyWorkHours", 8);

  it("剛好 8:00 通過、8:01 違反(上班時數 = 下班 − 上班 − 休息)", () => {
    expect(
      maxDailyWorkHoursEvaluator({
        ...person([
          entry("2026-11-05", "09:00", "17:30", { breakMinutes: 30 }),
        ]),
        setting: rule,
      }),
    ).toEqual([]);
    const over = maxDailyWorkHoursEvaluator({
      ...person([entry("2026-11-05", "09:00", "17:31", { breakMinutes: 30 })]),
      setting: rule,
    });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      key: "maxDailyWorkHours",
      level: "reminder",
      detail: { limit: 8, from: "2026-11-05" },
    });
    expect(over[0]?.detail?.actual).toBeCloseTo(8.02, 2);
  });

  it("同一人兩家店同一天加總:5 + 4 = 9 小時 → 違反,兩筆排班都列為對象", () => {
    const morning = entry("2026-11-05", "08:00", "13:00", { orgId: "a" });
    const evening = entry("2026-11-05", "17:00", "21:00", { orgId: "b" });
    const result = maxDailyWorkHoursEvaluator({
      ...person([morning, evening]),
      setting: rule,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.detail?.actual).toBe(9);
    expect(result[0]?.targets.map((target) => target.entryId)).toEqual([
      morning.id,
      evening.id,
    ]);
  });

  it("跨午夜的班算開始那天:11/5 18:00–11/6 03:00 + 11/6 白天 6 小時,11/6 只算 6 小時", () => {
    const night = entry("2026-11-05", "18:00", "03:00", {
      endDate: "2026-11-06",
    });
    const day = entry("2026-11-06", "10:00", "16:00");
    const result = maxDailyWorkHoursEvaluator({
      ...person([night, day]),
      setting: rule,
    });
    expect(result.map((item) => item.detail?.from)).toEqual(["2026-11-05"]);
    expect(result[0]?.detail?.actual).toBe(9);
  });

  it("可到 0.5 小時:7.5 小時的規則,7:30 通過、7:31 違反;只看這個月", () => {
    const half = setting("maxDailyWorkHours", 7.5);
    expect(
      maxDailyWorkHoursEvaluator({
        ...person([entry("2026-11-05", "09:00", "16:30")]),
        setting: half,
      }),
    ).toEqual([]);
    expect(
      maxDailyWorkHoursEvaluator({
        ...person([
          entry("2026-11-05", "09:00", "16:31"),
          entry("2026-10-31", "08:00", "20:00"),
        ]),
        setting: half,
      }),
    ).toHaveLength(1);
  });
});

describe("最多連續上班(規格 14.2;有排班的日子,任何分店)", () => {
  const rule = setting("maxConsecutiveWorkDays", 6);

  it("連續 6 天通過、7 天違反(列出這段的每一筆排班)", () => {
    expect(
      maxConsecutiveWorkDaysEvaluator({ ...person(days(6, 6)), setting: rule }),
    ).toEqual([]);
    const result = maxConsecutiveWorkDaysEvaluator({
      ...person(days(6, 7)),
      setting: rule,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.detail).toEqual({
      actual: 7,
      limit: 6,
      from: "2026-11-06",
      to: "2026-11-12",
    });
    expect(result[0]?.targets).toHaveLength(7);
  });

  it("跨月:10/28–11/3 連續 7 天算進 11 月;同一天兩段只算一天", () => {
    const result = maxConsecutiveWorkDaysEvaluator({
      ...person([
        ...days(28, 4, "2026-10"),
        ...days(1, 3),
        entry("2026-11-01", "18:00", "21:00"),
      ]),
      setting: rule,
    });
    expect(result.map((item) => item.detail?.actual)).toEqual([7]);
  });

  it("等級照設定:改成限制 → 違反是限制", () => {
    const result = maxConsecutiveWorkDaysEvaluator({
      ...person(days(1, 7)),
      setting: setting("maxConsecutiveWorkDays", 6, "limit"),
    });
    expect(result[0]?.level).toBe("limit");
  });
});

describe("兩班之間最少休息(規格 14.2;相鄰兩個上班日)", () => {
  const rule = setting("minRestBetweenShifts", 11);

  it("剛好 11 小時通過、10:59 違反(前一天最後下班 → 後一天第一次上班)", () => {
    expect(
      minRestBetweenShiftsEvaluator({
        ...person([
          entry("2026-11-04", "14:30", "22:00"),
          entry("2026-11-05", "09:00", "14:00"),
        ]),
        setting: rule,
      }),
    ).toEqual([]);
    const result = minRestBetweenShiftsEvaluator({
      ...person([
        entry("2026-11-04", "14:30", "22:00"),
        entry("2026-11-05", "08:59", "14:00"),
      ]),
      setting: rule,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      detail: { limit: 11, from: "2026-11-04", to: "2026-11-05" },
    });
    expect(result[0]?.detail?.actual).toBeCloseTo(10.98, 2);
  });

  it("同一天的兩段之間不算;跨店也算(看最後下班的那一筆)", () => {
    expect(
      minRestBetweenShiftsEvaluator({
        ...person([
          entry("2026-11-04", "08:00", "12:00"),
          entry("2026-11-04", "14:00", "18:00"),
        ]),
        setting: rule,
      }),
    ).toEqual([]);
    const result = minRestBetweenShiftsEvaluator({
      ...person([
        entry("2026-11-04", "08:00", "12:00", { orgId: "a" }),
        entry("2026-11-04", "17:00", "23:00", { orgId: "b" }),
        entry("2026-11-05", "08:00", "12:00", { orgId: "a" }),
      ]),
      setting: rule,
    });
    expect(result[0]?.detail?.actual).toBe(9);
  });
});

describe("同一時段兼多個崗位(規格 14.2;預設關閉)", () => {
  it("關閉 → 不檢查;開啟 → 同一筆排班同時段填進兩筆人力需求違反", () => {
    const both = entry("2026-11-05", "14:30", "22:00", {
      demands: demands("2026-11-05", [
        ["14:30", "22:00"],
        ["14:30", "22:00"],
      ]),
    });
    expect(
      multiPositionOverlapEvaluator({
        ...person([both]),
        setting: setting("multiPositionOverlap", null, "reminder", false),
      }),
    ).toEqual([]);
    const result = multiPositionOverlapEvaluator({
      ...person([both]),
      setting: setting("multiPositionOverlap", null),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.detail?.actual).toBe(2);
  });

  it("跨好幾段、時間相接的人力需求不算", () => {
    const sequential = entry("2026-11-05", "08:00", "18:00", {
      demands: demands("2026-11-05", [
        ["08:00", "12:00"],
        ["12:00", "18:00"],
      ]),
    });
    expect(
      multiPositionOverlapEvaluator({
        ...person([sequential]),
        setting: setting("multiPositionOverlap", null),
      }),
    ).toEqual([]);
  });
});

describe("人力不足(規格 14.2 / 14.5「人數檢查」:依時間切段檢查空的執行任務,附原因)", () => {
  const rule = setting("understaffed", null);
  const run = (
    demands: UnderstaffedDemandLike[],
    candidates: { userId: string; canLead: boolean }[] = [],
    busy: BusyLike[] = [],
    ruleSetting = rule,
  ) =>
    understaffedEvaluator({
      tenantId: "t",
      orgId: "store-a",
      setting: ruleSetting,
      data: { month: "2026-11", demands, candidates, busy },
    });

  it("都填滿 → 沒有;關閉 → 不檢查", () => {
    const filled = demand([
      {
        taskId: "t1",
        role: "leader",
        filledBy: {
          startAt: at("2026-11-05", "14:30"),
          endAt: at("2026-11-05", "22:00"),
        },
      },
    ]);
    expect(run([filled])).toEqual([]);
    expect(
      run(
        [demand([{ taskId: "t1", role: "helper", filledBy: null }])],
        [],
        [],
        setting("understaffed", null, "reminder", false),
      ),
    ).toEqual([]);
  });

  it("空的協同 → 整段缺 1 人(協同);可排 = 沒畫休、沒被占用的人", () => {
    const result = run(
      [demand([{ taskId: "t1", role: "helper", filledBy: null }])],
      [
        { userId: "a", canLead: false },
        { userId: "b", canLead: false },
      ],
      [
        {
          userId: "b",
          kind: "entry",
          startAt: at("2026-11-05", "18:00"),
          endAt: at("2026-11-05", "23:00"),
        },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.detail?.understaffed).toEqual({
      demandId: "d1",
      role: "helper",
      missing: 1,
      available: 1,
      dayOff: 0,
      timeRange: 0,
      occupied: 1,
      cannotLead: 0,
    });
    expect(result[0]?.targets).toEqual([{ date: "2026-11-05" }]);
  });

  it("填的人只上一部分時間 → 只有沒人顧的那段缺(依時間切段)", () => {
    const result = run([
      demand([
        {
          taskId: "t1",
          role: "helper",
          filledBy: {
            startAt: at("2026-11-05", "14:30"),
            endAt: at("2026-11-05", "18:00"),
          },
        },
        { taskId: "t2", role: "helper", filledBy: null },
      ]),
    ]);
    expect(
      result.map((item) => [
        item.detail?.startAt?.toISOString(),
        item.detail?.endAt?.toISOString(),
        item.detail?.understaffed?.missing,
      ]),
    ).toEqual([
      [
        at("2026-11-05", "14:30").toISOString(),
        at("2026-11-05", "18:00").toISOString(),
        1,
      ],
      [
        at("2026-11-05", "18:00").toISOString(),
        at("2026-11-05", "22:00").toISOString(),
        2,
      ],
    ]);
  });

  it("缺負責:不能擔任負責人、整天畫休、時段不可排各自算原因,可排 0", () => {
    const result = run(
      [demand([{ taskId: "t1", role: "leader", filledBy: null }])],
      [
        { userId: "a", canLead: false },
        { userId: "b", canLead: true },
        { userId: "c", canLead: true },
      ],
      [
        {
          userId: "b",
          kind: "full-day",
          startAt: at("2026-11-05", "00:00"),
          endAt: at("2026-11-06", "00:00"),
        },
        {
          userId: "c",
          kind: "time-range",
          startAt: at("2026-11-05", "20:00"),
          endAt: at("2026-11-05", "22:00"),
        },
      ],
    );
    expect(result[0]?.detail?.understaffed).toMatchObject({
      role: "leader",
      available: 0,
      cannotLead: 1,
      dayOff: 1,
      timeRange: 1,
    });
  });
});

describe("限制的嚴重程度(存排班時,存檔後比存檔前嚴重才擋)", () => {
  it("只算限制;超出規則值多少加總", () => {
    const severity = limitSeverityByKey([
      {
        key: "maxDailyWorkHours",
        level: "limit",
        message: "",
        targets: [],
        detail: { actual: 9, limit: 8 },
      },
      {
        key: "maxDailyWorkHours",
        level: "limit",
        message: "",
        targets: [],
        detail: { actual: 10, limit: 8 },
      },
      {
        key: "minRestBetweenShifts",
        level: "reminder",
        message: "",
        targets: [],
        detail: { actual: 9, limit: 11 },
      },
    ]);
    expect([...severity]).toEqual([["maxDailyWorkHours", 3]]);
  });
});
