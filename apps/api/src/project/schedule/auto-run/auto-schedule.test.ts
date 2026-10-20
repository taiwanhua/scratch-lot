import { describe, expect, it } from "@jest/globals";

import type {
  ScheduleAutoRunSortCondition,
  ScheduleRuleLevel,
} from "@repo/domain/project/schedule-settings";

import type { EffectiveRuleSetting } from "../rules/rule-registry";
import {
  type AutoBusy,
  type AutoDemand,
  type AutoEntry,
  type AutoScheduleInput,
  type AutoScheduleResult,
  autoSchedule,
} from "./auto-schedule";
import { seededRandom } from "./seeded-random";

/** 台北時間 → Date。 */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
/** 時點 → 台北的日期。 */
const dateOf = (instant: Date) =>
  new Date(instant.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
const hhmm = (instant: Date) =>
  new Date(instant.getTime() + 8 * 3_600_000).toISOString().slice(11, 16);

const STORE = "store-a";

const setting = (
  key: string,
  amount: number,
  level: ScheduleRuleLevel = "limit",
): EffectiveRuleSetting => ({
  key,
  enabled: true,
  value: { amount },
  level,
  order: 1,
});

const demand = (
  id: string,
  date: string,
  start: string,
  end: string,
  roles: ("leader" | "helper")[] = ["helper"],
): AutoDemand => ({
  id,
  date,
  startAt: at(date, start),
  endAt: at(date, end),
  tasks: roles.map((role, index) => ({
    taskId: `${id}-t${String(index)}`,
    role,
  })),
});

const entry = (
  id: string,
  userId: string,
  date: string,
  start: string,
  end: string,
  orgId = STORE,
): AutoEntry => ({
  id,
  userId,
  orgId,
  date,
  startAt: at(date, start),
  endAt: at(date, end),
  breakMinutes: 0,
});

const inputOf = (overrides: Partial<AutoScheduleInput>): AutoScheduleInput => ({
  storeId: STORE,
  month: "2026-11",
  seed: 42,
  demands: [],
  otherDemands: [],
  entries: [],
  assignments: [],
  candidates: [
    { userId: "a", canLead: true },
    { userId: "b", canLead: true },
  ],
  busy: [],
  closedDates: new Set(),
  sortConditions: [],
  allowOverlap: false,
  leaderCounts: new Map(),
  breakTiers: [
    { minMinutes: 240, breakMinutes: 30 },
    { minMinutes: 480, breakMinutes: 60 },
  ],
  settingsOf: () => new Map(),
  dateOf,
  ...overrides,
});

/** 填進結果寫成「需求/任務 → 誰」。 */
const fillsOf = (input: AutoScheduleInput, result: AutoScheduleResult) => {
  const userOf = new Map<string, string>([
    ...input.entries.map((item) => [item.id, item.userId] as const),
    ...result.newEntries.map((item) => [item.key, item.userId] as const),
  ]);
  return Object.fromEntries(
    result.fills.map((fill) => [fill.taskId, userOf.get(fill.entryKey) ?? "?"]),
  );
};

/** 規格 14.5「排序條件」情境表:候選人 a、b 都能排同一筆時誰排得到。 */
const pick = (
  conditions: ScheduleAutoRunSortCondition[],
  overrides: Partial<AutoScheduleInput> = {},
  role: "leader" | "helper" = "leader",
) => {
  const input = inputOf({
    demands: [demand("d", "2026-11-20", "08:30", "14:30", [role])],
    sortConditions: conditions,
    ...overrides,
  });
  const result = autoSchedule(input);
  return { winner: fillsOf(input, result)["d-t0"], fill: result.fills[0] };
};

describe("可指定種子的產生器", () => {
  it("同一個種子產生同一串數字,落在 [0, 1)", () => {
    const first = seededRandom(7);
    const second = seededRandom(7);
    const values = Array.from({ length: 5 }, () => first());
    expect(Array.from({ length: 5 }, () => second())).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seededRandom(8)()).not.toBe(values[0]);
  });
});

describe("排序條件(規格 14.5 情境表,每列一個測試)", () => {
  it("負責人次數:填負責人,A 12 次、B 3 次 → A,理由「負責人次數較多」", () => {
    const { winner, fill } = pick(["leaderCountFirst"], {
      leaderCounts: new Map([
        ["a", 12],
        ["b", 3],
      ]),
    });
    expect(winner).toBe("a");
    expect(fill?.reason).toBe("自動排入:負責人次數較多");
  });

  it("本月班數平均:A 10 班、B 6 班 → B", () => {
    const entries = [
      ...Array.from({ length: 10 }, (_, index) =>
        entry(
          `ea${String(index)}`,
          "a",
          `2026-11-0${String((index % 9) + 1)}`,
          "08:00",
          "09:00",
        ),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        entry(
          `eb${String(index)}`,
          "b",
          `2026-11-0${String(index + 1)}`,
          "08:00",
          "09:00",
        ),
      ),
    ];
    const { winner, fill } = pick(
      ["monthlyShiftBalance"],
      { entries },
      "helper",
    );
    expect(winner).toBe("b");
    expect(fill?.reason).toBe("自動排入:本月班數較少");
  });

  it("本月班數平均 → 負責人次數:A、B 都 6 班,A 負責 12 次、B 3 次 → 比負責人次數 → A", () => {
    const entries = ["a", "b"].flatMap((userId) =>
      Array.from({ length: 6 }, (_, index) =>
        entry(
          `e${userId}${String(index)}`,
          userId,
          `2026-11-0${String(index + 1)}`,
          "08:00",
          "09:00",
        ),
      ),
    );
    const { winner, fill } = pick(["monthlyShiftBalance", "leaderCountFirst"], {
      entries,
      leaderCounts: new Map([
        ["a", 12],
        ["b", 3],
      ]),
    });
    expect(winner).toBe("a");
    expect(fill?.reason).toBe("自動排入:負責人次數較多");
  });

  it("延續:A 已排 08–12,填 12–14 時 A、B 都能排 → A,A 的排班延長到 14:00(不另建一筆)", () => {
    const input = inputOf({
      demands: [demand("d2", "2026-11-20", "12:00", "14:00")],
      otherDemands: [demand("d1", "2026-11-20", "08:00", "12:00")],
      entries: [entry("ea", "a", "2026-11-20", "08:00", "12:00")],
      assignments: [{ entryId: "ea", demandId: "d1", taskId: "d1-t0" }],
      sortConditions: ["continuePreviousEntry"],
      candidates: [
        { userId: "a", canLead: true },
        { userId: "b", canLead: true },
      ],
      // b 的 id 排在 a 前面也一樣:延續先比
      seed: 3,
    });
    const result = autoSchedule(input);
    expect(fillsOf(input, result)).toEqual({ "d2-t0": "a" });
    expect(result.newEntries).toEqual([]);
    expect(
      result.changedEntries.map((item) => [
        item.entryId,
        hhmm(item.startAt),
        hhmm(item.endAt),
      ]),
    ).toEqual([["ea", "08:00", "14:00"]]);
    expect(result.fills[0]?.reason).toBe("自動排入:延續同一人的排班");
  });

  it("負責人次數只算這家店:A 這家店 12 次(另一家 20 次不算)、B 15 次 → B", () => {
    // 次數由呼叫端只算這家店(service 測試另驗);這裡給的就是這家店的數字
    const { winner } = pick(["leaderCountFirst"], {
      leaderCounts: new Map([
        ["a", 12],
        ["b", 15],
      ]),
    });
    expect(winner).toBe("b");
  });

  it("都不勾 → 隨機(依種子):理由「隨機」,同種子同結果、各種子 A / B 都會出現", () => {
    const winners = new Set<string | undefined>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const first = pick([], { seed });
      expect(pick([], { seed }).winner).toBe(first.winner);
      expect(first.fill?.reason).toBe("自動排入:隨機");
      winners.add(first.winner);
    }
    expect(winners).toEqual(new Set(["a", "b"]));
  });

  it("全部平手 → 隨機:理由「條件平手,隨機」", () => {
    const winners = new Set<string | undefined>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const result = pick(
        ["continuePreviousEntry", "leaderCountFirst", "monthlyShiftBalance"],
        { seed },
      );
      expect(result.fill?.reason).toBe("自動排入:條件平手,隨機");
      winners.add(result.winner);
    }
    expect(winners).toEqual(new Set(["a", "b"]));
  });

  it("負責人次數只比負責任務:填協同時次數不影響", () => {
    const { fill } = pick(
      ["leaderCountFirst"],
      {
        leaderCounts: new Map([
          ["a", 12],
          ["b", 3],
        ]),
      },
      "helper",
    );
    expect(fill?.reason).toBe("自動排入:條件平手,隨機");
  });

  it("只有一個人能排:理由「唯一可排的人」", () => {
    const { winner, fill } = pick(["leaderCountFirst"], {
      candidates: [
        { userId: "a", canLead: false },
        { userId: "b", canLead: true },
      ],
    });
    expect(winner).toBe("b");
    expect(fill?.reason).toBe("自動排入:唯一可排的人");
  });
});

describe("一定遵守(規格 14.5)", () => {
  const morning = () => demand("d", "2026-11-20", "08:30", "14:30");
  const only = (overrides: Partial<AutoScheduleInput>) => {
    const input = inputOf({ demands: [morning()], ...overrides });
    return fillsOf(input, autoSchedule(input))["d-t0"];
  };
  const dayOff = (
    userId: string,
    start: string,
    end: string,
    endDate = "2026-11-20",
  ): AutoBusy => ({
    userId,
    startAt: at("2026-11-20", start),
    endAt: at(endDate, end),
  });

  it("整天畫休不排", () => {
    expect(only({ busy: [dayOff("a", "00:00", "00:00", "2026-11-21")] })).toBe(
      "b",
    );
  });

  it("時段不可排(重疊)不排;頭尾相接可以排", () => {
    expect(only({ busy: [dayOff("a", "13:00", "17:00")] })).toBe("b");
    expect(
      only({
        busy: [
          dayOff("a", "14:30", "17:00"),
          dayOff("b", "00:00", "00:00", "2026-11-21"),
        ],
      }),
    ).toBe("a");
  });

  it("店休那天不排(跨午夜的班碰到隔天店休也不排)", () => {
    expect(only({ closedDates: new Set(["2026-11-20"]) })).toBeUndefined();
    const night: AutoDemand = {
      id: "n",
      date: "2026-11-20",
      startAt: at("2026-11-20", "22:00"),
      endAt: at("2026-11-21", "06:00"),
      tasks: [{ taskId: "n-t0", role: "helper" }],
    };
    const result = autoSchedule(
      inputOf({ demands: [night], closedDates: new Set(["2026-11-21"]) }),
    );
    expect(result.fills).toEqual([]);
    expect(result.unfilledCount).toBe(1);
  });

  it("限制等級的規則:每天最多上班時數(限制)超過就不排;改成提醒照排", () => {
    const entries = [entry("ea", "a", "2026-11-20", "15:00", "21:00")];
    const limited = (level: ScheduleRuleLevel) => (userId: string) =>
      userId === "a"
        ? new Map([
            ["maxDailyWorkHours", setting("maxDailyWorkHours", 8, level)],
          ])
        : new Map<string, EffectiveRuleSetting>();
    const alone = [{ userId: "a", canLead: true }];
    expect(
      only({ entries, candidates: alone, settingsOf: limited("limit") }),
    ).toBeUndefined();
    expect(
      only({ entries, candidates: alone, settingsOf: limited("reminder") }),
    ).toBe("a");
  });

  it("限制等級的規則:最多連續上班(限制 3 天)第 4 天不排", () => {
    const entries = ["17", "18", "19"].map((day) =>
      entry(`e${day}`, "a", `2026-11-${day}`, "08:00", "12:00"),
    );
    expect(
      only({
        entries,
        candidates: [{ userId: "a", canLead: true }],
        settingsOf: () =>
          new Map([
            ["maxConsecutiveWorkDays", setting("maxConsecutiveWorkDays", 3)],
          ]),
      }),
    ).toBeUndefined();
  });

  it("負責任務只給可以擔任負責人的人;排不到就留空、記一筆沒排滿", () => {
    const input = inputOf({
      demands: [
        demand("d", "2026-11-20", "08:30", "14:30", ["leader", "helper"]),
      ],
      candidates: [
        { userId: "a", canLead: false },
        { userId: "b", canLead: false },
      ],
    });
    const result = autoSchedule(input);
    expect(Object.keys(fillsOf(input, result))).toEqual(["d-t1"]);
    expect(result.unfilledCount).toBe(1);
  });

  it("同一筆人力需求同一個人只填一筆;一筆任務只填一人(已填的不動)", () => {
    const input = inputOf({
      demands: [
        demand("d", "2026-11-20", "08:30", "14:30", [
          "leader",
          "helper",
          "helper",
        ]),
      ],
      entries: [entry("eb", "b", "2026-11-20", "08:30", "14:30")],
      assignments: [{ entryId: "eb", demandId: "d", taskId: "d-t1" }],
    });
    const result = autoSchedule(input);
    expect(fillsOf(input, result)).toEqual({ "d-t0": "a" });
    expect(result.unfilledCount).toBe(1);
  });

  it("別家店同時段有班(一個人同一時間只有一筆排班,跨店也算)→ 不排", () => {
    expect(
      only({
        entries: [entry("x", "a", "2026-11-20", "10:00", "18:00", "store-b")],
      }),
    ).toBe("b");
  });

  it("新建的排班休息依規則「預設休息」(6 小時 → 30 分)", () => {
    const input = inputOf({ demands: [morning()] });
    expect(autoSchedule(input).newEntries[0]?.breakMinutes).toBe(30);
  });
});

describe("兼多個崗位(規格 14.5:允許同一人同時段填進多筆人力需求)", () => {
  const twoCounters = (allowOverlap: boolean) => {
    const input = inputOf({
      demands: [
        demand("x", "2026-11-20", "14:30", "22:00"),
        demand("y", "2026-11-20", "14:30", "22:00"),
      ],
      candidates: [{ userId: "a", canLead: true }],
      allowOverlap,
    });
    return { input, result: autoSchedule(input) };
  };

  it("沒勾 → 不會讓同一人填進時間重疊的兩筆", () => {
    const { input, result } = twoCounters(false);
    expect(fillsOf(input, result)).toEqual({ "x-t0": "a" });
    expect(result.unfilledCount).toBe(1);
  });

  it("勾了 → 同一筆排班填進兩筆(一人顧兩台)", () => {
    const { result } = twoCounters(true);
    expect(result.fills).toHaveLength(2);
    expect(new Set(result.fills.map((fill) => fill.entryKey)).size).toBe(1);
    expect(result.newEntries).toHaveLength(1);
  });
});

describe("固定種子的整月排班(輸入夾具 → 預期填進結果)", () => {
  /** 2026 年 11 月:每天早班(負責 + 協同)與晚班(負責 + 協同);11/3 店休;六個人,前三位可擔任負責人。 */
  const monthInput = (seed: number): AutoScheduleInput => {
    const days = Array.from(
      { length: 30 },
      (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`,
    ).filter((day) => day !== "2026-11-03");
    return inputOf({
      seed,
      demands: days.flatMap((day) => [
        demand(`${day}-am`, day, "08:30", "14:30", ["leader", "helper"]),
        demand(`${day}-pm`, day, "14:30", "22:00", ["leader", "helper"]),
      ]),
      candidates: ["p1", "p2", "p3", "p4", "p5", "p6"].map((userId, index) => ({
        userId,
        canLead: index < 3,
      })),
      sortConditions: [
        "continuePreviousEntry",
        "leaderCountFirst",
        "monthlyShiftBalance",
      ],
      leaderCounts: new Map([
        ["p1", 5],
        ["p2", 5],
        ["p3", 1],
      ]),
      busy: [
        {
          userId: "p1",
          startAt: at("2026-11-10", "00:00"),
          endAt: at("2026-11-11", "00:00"),
        },
        {
          userId: "p4",
          startAt: at("2026-11-15", "09:00"),
          endAt: at("2026-11-15", "13:00"),
        },
      ],
      settingsOf: () =>
        new Map([
          ["maxDailyWorkHours", setting("maxDailyWorkHours", 8)],
          ["maxConsecutiveWorkDays", setting("maxConsecutiveWorkDays", 6)],
        ]),
    });
  };

  /** 每天「早負責/早協同/晚負責/晚協同」 */
  const scheduleOf = (input: AutoScheduleInput, result: AutoScheduleResult) => {
    const fills = fillsOf(input, result);
    return Object.fromEntries(
      input.demands
        .filter((item) => item.id.endsWith("-am"))
        .map((item) => {
          const day = item.date;
          return [
            day.slice(5),
            [`${day}-am-t0`, `${day}-am-t1`, `${day}-pm-t0`, `${day}-pm-t1`]
              .map((taskId) => fills[taskId] ?? "-")
              .join("/"),
          ];
        }),
    );
  };

  it("同一個種子兩次結果相同", () => {
    const first = autoSchedule(monthInput(20_261_101));
    const second = autoSchedule(monthInput(20_261_101));
    expect(second).toEqual(first);
  });

  it("夾具的預期結果:守住畫休 / 每天時數 / 連續上班、負責只給可負責的人;排不滿的留空(三位可負責的人連續上班到上限)", () => {
    const input = monthInput(20_261_101);
    const result = autoSchedule(input);
    expect(result.unfilledCount).toBe(3);
    expect(result.fills).toHaveLength(29 * 4 - 3);
    const schedule = scheduleOf(input, result);
    // 11/10 p1 整天畫休;負責(t0)只有 p1–p3
    expect(
      Object.values(schedule).every((day) => {
        const [amLead, , pmLead] = day.split("/");
        return (
          ["p1", "p2", "p3", "-"].includes(amLead ?? "") &&
          ["p1", "p2", "p3", "-"].includes(pmLead ?? "")
        );
      }),
    ).toBe(true);
    expect(schedule["11-10"]?.includes("p1")).toBe(false);
    expect(schedule["11-15"]?.split("/").slice(0, 2).includes("p4")).toBe(
      false,
    );
    // 每天每人最多一班(早 6 小時 + 晚 7.5 小時超過 8 小時)
    for (const day of Object.values(schedule)) {
      const people = day.split("/").filter((person) => person !== "-");
      expect(new Set(people).size).toBe(people.length);
    }
    expect(schedule).toMatchInlineSnapshot(`
     {
       "11-01": "p1/p3/p2/p6",
       "11-02": "p2/p4/p1/p5",
       "11-04": "p1/p3/p2/p5",
       "11-05": "p1/p4/p2/p6",
       "11-06": "p2/p5/p1/p4",
       "11-07": "p1/p3/p2/p6",
       "11-08": "p1/p4/p2/p3",
       "11-09": "p2/p5/p1/p6",
       "11-10": "p3/p5/-/p4",
       "11-11": "p1/p6/p2/p4",
       "11-12": "p1/p5/p2/p3",
       "11-13": "p2/p6/p1/p4",
       "11-14": "p1/p5/p2/p6",
       "11-15": "p1/p3/p2/p4",
       "11-16": "p2/p3/p1/p6",
       "11-17": "p3/p5/-/p6",
       "11-18": "p1/p4/p2/p5",
       "11-19": "p2/p5/p1/p4",
       "11-20": "p2/p3/p1/p6",
       "11-21": "p2/p5/p1/p3",
       "11-22": "p1/p6/p2/p4",
       "11-23": "p2/p5/p1/p6",
       "11-24": "p3/p4/-/p5",
       "11-25": "p1/p3/p2/p6",
       "11-26": "p1/p4/p2/p3",
       "11-27": "p1/p4/p2/p6",
       "11-28": "p2/p5/p1/p4",
       "11-29": "p1/p3/p2/p5",
       "11-30": "p2/p6/p1/p4",
     }
    `);
  });

  it("換一個種子會排出不同結果(亂數真的有作用)", () => {
    const first = autoSchedule(monthInput(1));
    const second = autoSchedule(monthInput(2));
    expect(scheduleOf(monthInput(1), first)).not.toEqual(
      scheduleOf(monthInput(2), second),
    );
  });
});
