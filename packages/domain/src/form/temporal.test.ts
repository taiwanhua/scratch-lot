import { describe, expect, it } from "@jest/globals";

import { recheckRegexSafety } from "../form-regex-safety";
import { computeAll } from "./compute";
import { evaluateCondition, evaluateExpression } from "./expression";
import { CTX, definitionOf, field } from "./form-test-support";
import { computeSummary } from "./summary";
import {
  addLocalCalendar,
  addLocalDays,
  addLocalMonths,
  clampedDateOfMonth,
  compareLocalDay,
  datesOfLocalMonth,
  daysInLocalMonth,
  formatTemporal,
  instantOfLocalHhMm,
  instantOfLocalTime,
  isHhMm,
  localDateDiff,
  localDateOf,
  localDayRange,
  localMonthDiff,
  localMonthOf,
  localMonthRange,
  localMonthText,
  minutesOfHhMm,
  parseLocalDate,
  parseLocalMonth,
  sameLocalDay,
  startOfLocalDay,
  toInstant,
  toIso,
  weekdayOfLocalDate,
} from "./temporal";
import type { Expression } from "./types";
import { validateDefinition } from "./validate-definition";
import { normalizeFieldValue, validateFieldRules } from "./values";

const TAIPEI = "Asia/Taipei";
const NEW_YORK = "America/New_York";

const evaluate = (expr: Expression, values: Record<string, unknown> = {}) =>
  evaluateExpression(expr, { values, ctx: CTX });

const iso = (instant: number | null) =>
  instant === null ? null : toIso(instant);

describe("@repo/domain/form toInstant:單一入口", () => {
  it("收 Date 與帶時區的 ISO 字串,回 ms", () => {
    const at = Date.parse("2026-09-26T06:30:00Z");
    expect(toInstant(new Date(at))).toBe(at);
    expect(toInstant("2026-09-26T06:30:00Z")).toBe(at);
    expect(toInstant("2026-09-26T14:30+08:00")).toBe(at);
    expect(toInstant("2026-09-26T06:30:00.000Z")).toBe(at);
  });

  it("沒有時區、只有日期、不存在的時間、數字、Invalid Date → null", () => {
    for (const value of [
      "2026-09-26T14:30",
      "2026-09-26",
      "2026-13-01T00:00:00Z",
      // 不存在的日期:Date.parse 會滾到 3/2,要擋下
      "2026-02-30T00:00:00Z",
      "2025-02-29T12:00:00+08:00",
      "2026-04-31T00:00:00Z",
      1_700_000_000_000,
      new Date(Number.NaN),
      null,
      undefined,
      "",
    ]) {
      expect(toInstant(value)).toBeNull();
    }
  });
});

describe("@repo/domain/form instantOfLocalTime", () => {
  it("同一個當地日期的 08:00 在台北與紐約是不同時點", () => {
    const date = { year: 2026, month: 10, day: 16 };
    expect(toIso(instantOfLocalTime(date, 8, 0, TAIPEI))).toBe(
      "2026-10-16T00:00:00.000Z",
    );
    expect(toIso(instantOfLocalTime(date, 8, 0, NEW_YORK))).toBe(
      "2026-10-16T12:00:00.000Z",
    );
  });

  it("夏令時間開始日不存在的 02:30 落在切換後(03:30 EDT);結束日重複的 01:30 取較早的一個", () => {
    expect(
      toIso(
        instantOfLocalTime({ year: 2026, month: 3, day: 8 }, 2, 30, NEW_YORK),
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      toIso(
        instantOfLocalTime({ year: 2026, month: 11, day: 1 }, 1, 30, NEW_YORK),
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("@repo/domain/form startOfLocalDay / localDateOf", () => {
  it("台北選 09-26 → 2026-09-25T16:00:00.000Z,往返回同一天", () => {
    const instant = startOfLocalDay({ year: 2026, month: 9, day: 26 }, TAIPEI);
    expect(toIso(instant)).toBe("2026-09-25T16:00:00.000Z");
    expect(localDateOf(instant, TAIPEI)).toEqual({
      year: 2026,
      month: 9,
      day: 26,
    });
  });

  it("同一個時點在紐約落在前一天(預期行為)", () => {
    const instant = startOfLocalDay({ year: 2026, month: 9, day: 26 }, TAIPEI);
    expect(localDateOf(instant, NEW_YORK)).toEqual({
      year: 2026,
      month: 9,
      day: 25,
    });
  });

  it("UTC 與負時區", () => {
    expect(
      toIso(startOfLocalDay({ year: 2026, month: 9, day: 26 }, "UTC")),
    ).toBe("2026-09-26T00:00:00.000Z");
    expect(
      toIso(startOfLocalDay({ year: 2026, month: 9, day: 26 }, NEW_YORK)),
    ).toBe("2026-09-26T04:00:00.000Z");
    expect(
      toIso(startOfLocalDay({ year: 2026, month: 1, day: 15 }, NEW_YORK)),
    ).toBe("2026-01-15T05:00:00.000Z");
  });

  it("夏令時間切換日:紐約 3/8(開始)與 11/1(結束)的 00:00 都在切換前", () => {
    expect(
      toIso(startOfLocalDay({ year: 2026, month: 3, day: 8 }, NEW_YORK)),
    ).toBe("2026-03-08T05:00:00.000Z");
    expect(
      toIso(startOfLocalDay({ year: 2026, month: 11, day: 1 }, NEW_YORK)),
    ).toBe("2026-11-01T04:00:00.000Z");
  });

  it("午夜不存在的時區(聖地牙哥夏令時間在 00:00 開始)→ 當天第一個時點", () => {
    const instant = startOfLocalDay(
      { year: 2026, month: 9, day: 6 },
      "America/Santiago",
    );
    expect(localDateOf(instant, "America/Santiago")).toEqual({
      year: 2026,
      month: 9,
      day: 6,
    });
    expect(localDateOf(instant - 1000, "America/Santiago").day).toBe(5);
  });

  it("parseLocalDate:格式不對或不存在的日期 → null", () => {
    expect(parseLocalDate("2026-02-28")).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-9-1")).toBeNull();
  });
});

describe("@repo/domain/form compareLocalDay / sameLocalDay", () => {
  const dateValue = "2026-09-25T16:00:00.000Z"; // 台北 09-26 00:00
  it("日期與日期時間互比:換成當地日期再比,不看時分秒", () => {
    expect(compareLocalDay(dateValue, "2026-09-26T06:30:00Z", TAIPEI)).toBe(0);
    expect(sameLocalDay(dateValue, "2026-09-26T15:59:59Z", TAIPEI)).toBe(true);
    expect(compareLocalDay(dateValue, "2026-09-26T16:00:00Z", TAIPEI)).toBe(-1);
    expect(compareLocalDay(new Date(dateValue), dateValue, TAIPEI)).toBe(0);
    expect(compareLocalDay("2026-09-27T00:00:00Z", dateValue, TAIPEI)).toBe(1);
  });

  it("時區決定是哪一天:同兩個時點在紐約是不同天", () => {
    expect(sameLocalDay(dateValue, "2026-09-26T06:30:00Z", NEW_YORK)).toBe(
      false,
    );
  });

  it("任一不是時點或時區不合法 → null", () => {
    expect(compareLocalDay("2026-09-26", dateValue, TAIPEI)).toBeNull();
    expect(compareLocalDay(dateValue, dateValue, "Not/AZone")).toBeNull();
  });
});

const midnight = (year: number, month: number, day: number) =>
  startOfLocalDay({ year, month, day }, TAIPEI);

describe("@repo/domain/form addLocalCalendar", () => {
  it("days / weeks 加減當地日期,仍是當地 00:00", () => {
    expect(
      iso(addLocalCalendar(midnight(2026, 9, 26), 7, "days", TAIPEI)),
    ).toBe(iso(midnight(2026, 10, 3)));
    expect(
      iso(addLocalCalendar(midnight(2026, 9, 26), -2, "weeks", TAIPEI)),
    ).toBe(iso(midnight(2026, 9, 12)));
  });

  it("月底溢出取該月最後一天(平年 / 閏年、加年)", () => {
    expect(
      iso(addLocalCalendar(midnight(2026, 1, 31), 1, "months", TAIPEI)),
    ).toBe(iso(midnight(2026, 2, 28)));
    expect(
      iso(addLocalCalendar(midnight(2024, 1, 31), 1, "months", TAIPEI)),
    ).toBe(iso(midnight(2024, 2, 29)));
    expect(
      iso(addLocalCalendar(midnight(2024, 2, 29), 1, "years", TAIPEI)),
    ).toBe(iso(midnight(2025, 2, 28)));
    expect(
      iso(addLocalCalendar(midnight(2026, 3, 31), -1, "months", TAIPEI)),
    ).toBe(iso(midnight(2026, 2, 28)));
  });

  it("日期時間:時分不變、跨夏令時間仍是當地同一時刻", () => {
    expect(
      iso(
        addLocalCalendar(
          Date.parse("2026-09-26T06:30:00Z"),
          1,
          "months",
          TAIPEI,
        ),
      ),
    ).toBe("2026-10-26T06:30:00.000Z");
    // 紐約 3/7 12:00 EST + 1 天 = 3/8 12:00 EDT
    expect(
      iso(
        addLocalCalendar(
          Date.parse("2026-03-07T17:00:00Z"),
          1,
          "days",
          NEW_YORK,
        ),
      ),
    ).toBe("2026-03-08T16:00:00.000Z");
  });
});

describe("@repo/domain/form formatTemporal", () => {
  it("date 印 YYYY-MM-DD、datetime 印 YYYY-MM-DD HH:mm(依給的時區)", () => {
    const value = "2026-09-26T06:30:00Z";
    expect(formatTemporal(value, { type: "date", timezone: TAIPEI })).toBe(
      "2026-09-26",
    );
    expect(formatTemporal(value, { type: "datetime", timezone: TAIPEI })).toBe(
      "2026-09-26 14:30",
    );
    expect(
      formatTemporal(new Date(value), { type: "datetime", timezone: NEW_YORK }),
    ).toBe("2026-09-26 02:30");
    expect(
      formatTemporal("2026-09-25T16:00:00.000Z", {
        type: "date",
        timezone: NEW_YORK,
      }),
    ).toBe("2026-09-25");
  });

  it("monthDay 印 M/D、monthDayTime 印 M/D HH:mm(依給的時區;月日不補零、時分補零)", () => {
    const value = "2026-10-12T06:35:00Z";
    expect(formatTemporal(value, { type: "monthDay", timezone: TAIPEI })).toBe(
      "10/12",
    );
    expect(
      formatTemporal(value, { type: "monthDayTime", timezone: TAIPEI }),
    ).toBe("10/12 14:35");
    // 跨日:紐約還是前一天
    expect(
      formatTemporal("2026-09-05T02:00:00Z", {
        type: "monthDayTime",
        timezone: NEW_YORK,
      }),
    ).toBe("9/4 22:00");
    expect(
      formatTemporal("2026-03-05T01:05:00Z", {
        type: "monthDayTime",
        timezone: TAIPEI,
      }),
    ).toBe("3/5 09:05");
    expect(formatTemporal(null, { type: "monthDay", timezone: TAIPEI })).toBe(
      "",
    );
  });

  it("空值 → 空字串;不是時點的字串原樣回;時區不合法以 UTC 顯示", () => {
    expect(formatTemporal(null, { type: "date", timezone: TAIPEI })).toBe("");
    expect(
      formatTemporal("2026-09-26", { type: "date", timezone: TAIPEI }),
    ).toBe("2026-09-26");
    expect(
      formatTemporal("2026-09-26T06:30:00Z", {
        type: "datetime",
        timezone: "Not/AZone",
      }),
    ).toBe("2026-09-26 06:30");
  });
});

describe("@repo/domain/form date / datetime:正規化", () => {
  const meeting = field("meeting", "datetime");
  const day = field("day", "date");

  it("datetime:帶時區的輸入一律存成 ISO(UTC)", () => {
    expect(normalizeFieldValue(meeting, "2026-03-01T09:30+08:00")).toEqual({
      ok: true,
      value: "2026-03-01T01:30:00.000Z",
    });
    expect(
      normalizeFieldValue(meeting, new Date("2026-03-01T01:30:15.987Z")),
    ).toEqual({ ok: true, value: "2026-03-01T01:30:15.987Z" });
    expect(normalizeFieldValue(meeting, "")).toEqual({ ok: true, value: null });
  });

  it("date:給了租戶時區就收斂成當地那一天 00:00", () => {
    expect(normalizeFieldValue(day, "2026-09-26T06:30:00Z", TAIPEI)).toEqual({
      ok: true,
      value: "2026-09-25T16:00:00.000Z",
    });
    expect(
      normalizeFieldValue(day, "2026-09-25T16:00:00.000Z", TAIPEI),
    ).toEqual({ ok: true, value: "2026-09-25T16:00:00.000Z" });
  });

  it("沒有時區、只有日期、不存在的時間 → TYPE_INVALID", () => {
    for (const target of [meeting, day]) {
      for (const raw of [
        "2026-03-01T09:30",
        "2026-03-01",
        "2026-13-01T00:00:00Z",
        1_700_000_000_000,
      ]) {
        expect(normalizeFieldValue(target, raw, TAIPEI).ok).toBe(false);
      }
    }
  });

  it("datetime 上下限(min / max)以時點比較", () => {
    const limited = field("meeting", "datetime", {
      rules: { min: "2026-03-01T00:00:00Z", max: "2026-03-31T23:59:59+08:00" },
    });
    const ruleOf = (value: unknown) =>
      validateFieldRules(limited, value, {
        semantic: {},
        ctx: CTX,
        fields: [limited],
        stored: {},
      })?.code ?? null;
    expect(ruleOf("2026-02-28T23:59:59Z")).toBe("MIN");
    expect(ruleOf(new Date("2026-03-31T15:59:59Z"))).toBeNull();
    expect(ruleOf("2026-03-31T16:00:00Z")).toBe("MAX");
  });

  it("date 上下限以租戶時區的當地日期比較,訊息印日期", () => {
    const limited = field("day", "date", {
      rules: { max: "2026-01-31T16:00:00.000Z" }, // 台北 2026-02-01
    });
    const issueOf = (value: unknown) =>
      validateFieldRules(limited, value, {
        semantic: {},
        ctx: CTX,
        fields: [limited],
        stored: {},
      });
    expect(issueOf("2026-01-31T16:00:00.000Z")).toBeNull();
    expect(issueOf(new Date("2026-02-01T16:00:00.000Z"))?.message).toBe(
      "「day」不可晚於 2026-02-01",
    );
  });

  it("超出上下限的訊息以租戶時區顯示;上下限格式不合法 → 檢查器 RULE_RANGE_INVALID", () => {
    const limited = field("meeting", "datetime", {
      rules: { min: "2026-03-01T00:00:00Z" },
    });
    expect(
      validateFieldRules(limited, "2026-02-28T00:00:00Z", {
        semantic: {},
        ctx: CTX,
        fields: [limited],
        stored: {},
      })?.message,
    ).toBe("「meeting」不可早於 2026-03-01 08:00(Asia/Taipei)");
    const report = validateDefinition(
      definitionOf([
        field("title", "text"),
        field("meeting", "datetime", {
          rules: { min: "2026-03-01 09:00", max: "2026-03-31T23:59+08:00" },
        }),
        field("day", "date", { rules: { max: "2026-03-31" } }),
      ]),
      { regexSafety: recheckRegexSafety },
    );
    expect(
      report.errors.map((issue) => [
        issue.code,
        issue.location.fieldKey,
        issue.location.property,
      ]),
    ).toEqual([
      ["RULE_RANGE_INVALID", "meeting", "rules.min"],
      ["RULE_RANGE_INVALID", "day", "rules.max"],
    ]);
  });
});

describe("@repo/domain/form date / datetime:比較與計算", () => {
  it("比較以時點:同一刻不同寫法相等、Date 與字串可比、帶毫秒的 now 與存值可比大小", () => {
    expect(
      evaluateCondition(
        { "==": [{ var: "at" }, "2026-03-01T09:00:00+08:00"] },
        { values: { at: "2026-03-01T01:00:00Z" }, ctx: CTX },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { "==": [{ var: "at" }, "2026-03-01T01:00:00.000Z"] },
        { values: { at: new Date("2026-03-01T01:00:00Z") }, ctx: CTX },
      ),
    ).toBe(true);
    // CTX.now = 2026-03-01T01:00:00.000Z
    expect(
      evaluateCondition(
        { "<=": [{ var: "at" }, { now: [] }] },
        { values: { at: "2026-03-01T01:00:00Z" }, ctx: CTX },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { ">": [{ var: "at" }, { now: [] }] },
        { values: { at: "2026-03-01T01:00:01Z" }, ctx: CTX },
      ),
    ).toBe(true);
  });

  it("計算欄位:datetime 回 ISO;date 收斂成租戶時區當天 00:00;存值是 Date 也收", () => {
    const stamped = field("stamped", "datetime", {
      valueSource: { kind: "computed", expr: { now: [] } },
    });
    const today = field("today", "date", {
      valueSource: { kind: "computed", expr: { now: [] } },
    });
    const copied = field("copied", "date", {
      valueSource: { kind: "computed", expr: { var: "due" } },
    });
    const due = field("due", "date");
    expect(
      computeAll([stamped, today, copied, due], {
        values: { due: new Date("2026-03-04T16:00:00.000Z") },
        ctx: CTX,
      }),
    ).toEqual({
      stamped: "2026-03-01T01:00:00.000Z",
      today: "2026-02-28T16:00:00.000Z",
      copied: "2026-03-04T16:00:00.000Z",
    });
  });

  it("摘要槽 date:對日期時間欄存 ISO、存值是 Date 也收;沒對欄位 = 送出時間", () => {
    const at = field("at", "datetime");
    expect(
      computeSummary(
        { fields: [at], summaryMap: { date: "at" } },
        { at: new Date("2026-03-01T01:00:00Z") },
        { submittedAt: "2026-04-01T00:00:00.000Z" },
      ).date,
    ).toBe("2026-03-01T01:00:00.000Z");
    expect(
      computeSummary(
        { fields: [at], summaryMap: {} },
        {},
        { submittedAt: "2026-04-01T00:00:00.000Z" },
      ).date,
    ).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("@repo/domain/form dateDiff 三種單位", () => {
  it("days(預設):租戶時區的當地日期差 —— 台北 3/1 23:30 到 3/2 00:10 = 1 天", () => {
    const values = {
      from: "2026-03-01T15:30:00Z",
      to: "2026-03-01T16:10:00Z",
    };
    expect(
      evaluate({ dateDiff: [{ var: "from" }, { var: "to" }] }, values),
    ).toBe("1");
    expect(
      evaluate({ dateDiff: [{ var: "from" }, { var: "to" }, "days"] }, values),
    ).toBe("1");
  });

  it("days:日期(當地 00:00)與日期時間互算", () => {
    // 台北 3/1 00:00 → 台北 3/3 09:00
    expect(
      evaluate({
        dateDiff: ["2026-02-28T16:00:00.000Z", "2026-03-03T01:00:00Z"],
      }),
    ).toBe("2");
  });

  it("hours:時點差,可有小數(90 分鐘 = 1.5 小時)", () => {
    expect(
      evaluate({
        dateDiff: ["2026-03-01T01:00:00Z", "2026-03-01T02:30:00Z", "hours"],
      }),
    ).toBe("1.5");
  });

  it("minutes:日期是當地 00:00 的時點(台北 3/2 00:00 → 3/2 01:15 = 75 分)", () => {
    expect(
      evaluate({
        dateDiff: [
          "2026-03-01T16:00:00.000Z",
          "2026-03-01T17:15:00Z",
          "minutes",
        ],
      }),
    ).toBe("75");
  });

  it("認不得的單位、無效值、沒有時區的字串 → null", () => {
    expect(
      evaluate({
        dateDiff: ["2026-03-01T01:00:00Z", "2026-03-01T02:00:00Z", "weeks"],
      }),
    ).toBeNull();
    expect(
      evaluate({ dateDiff: [null, "2026-03-01T02:00:00Z", "hours"] }),
    ).toBeNull();
    expect(evaluate({ dateDiff: ["2026-03-01", "2026-03-03"] })).toBeNull();
  });
});

describe("@repo/domain/form 時刻 HH:mm", () => {
  it.each([
    ["00:00", true],
    ["08:30", true],
    ["23:59", true],
    ["24:00", false],
    ["8:30", false],
    ["08:60", false],
    ["08:30:00", false],
    ["", false],
    [null, false],
    [830, false],
  ])("isHhMm(%p) → %p", (value, expected) => {
    expect(isHhMm(value)).toBe(expected);
  });

  it("minutesOfHhMm:換成 00:00 起算的分鐘數,不合法 → null", () => {
    expect(minutesOfHhMm("00:00")).toBe(0);
    expect(minutesOfHhMm("13:45")).toBe(825);
    expect(minutesOfHhMm("23:59")).toBe(1439);
    expect(minutesOfHhMm("24:00")).toBeNull();
  });
});

describe("@repo/domain/form instantOfLocalHhMm", () => {
  it("租戶當地那天的 HH:mm → 時點", () => {
    expect(
      iso(
        instantOfLocalHhMm({ year: 2026, month: 10, day: 24 }, "09:30", TAIPEI),
      ),
    ).toBe("2026-10-24T01:30:00.000Z");
    expect(
      iso(
        instantOfLocalHhMm({ year: 2026, month: 10, day: 24 }, "00:00", TAIPEI),
      ),
    ).toBe("2026-10-23T16:00:00.000Z");
  });

  it("HH:mm 不合法 → null", () => {
    expect(
      instantOfLocalHhMm({ year: 2026, month: 10, day: 24 }, "24:00", TAIPEI),
    ).toBeNull();
    expect(
      instantOfLocalHhMm({ year: 2026, month: 10, day: 24 }, "", TAIPEI),
    ).toBeNull();
  });

  it("不存在的時刻(紐約夏令時間開始)往後推到切換後", () => {
    // 2026-03-08 02:00 → 03:00;02:30 不存在,落在 03:30 EDT(與 instantOfLocalTime 同一條規則)
    expect(
      iso(
        instantOfLocalHhMm({ year: 2026, month: 3, day: 8 }, "02:30", NEW_YORK),
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("重複的時刻(紐約夏令時間結束)取較早的一個", () => {
    // 2026-11-01 01:30 出現兩次:EDT(05:30Z)與 EST(06:30Z)
    expect(
      iso(
        instantOfLocalHhMm(
          { year: 2026, month: 11, day: 1 },
          "01:30",
          NEW_YORK,
        ),
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("@repo/domain/form 純日曆:日期", () => {
  it("addLocalDays:跨月、跨年、閏年照日曆進位;負數往前", () => {
    expect(addLocalDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 1,
    });
    expect(addLocalDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
    expect(addLocalDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(addLocalDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addLocalDays({ year: 2026, month: 3, day: 1 }, 0)).toEqual({
      year: 2026,
      month: 3,
      day: 1,
    });
  });

  it("addLocalDays:夏令時間切換日不影響(純日曆,不經過時點)", () => {
    expect(addLocalDays({ year: 2026, month: 3, day: 7 }, 2)).toEqual({
      year: 2026,
      month: 3,
      day: 9,
    });
  });

  it("localDateDiff:to − from 的日曆日數", () => {
    expect(
      localDateDiff(
        { year: 2026, month: 2, day: 27 },
        { year: 2026, month: 3, day: 2 },
      ),
    ).toBe(3);
    expect(
      localDateDiff(
        { year: 2026, month: 3, day: 2 },
        { year: 2026, month: 2, day: 27 },
      ),
    ).toBe(-3);
    expect(
      localDateDiff(
        { year: 2026, month: 3, day: 2 },
        { year: 2026, month: 3, day: 2 },
      ),
    ).toBe(0);
  });

  it("weekdayOfLocalDate:0 = 星期日 … 6 = 星期六", () => {
    expect(weekdayOfLocalDate({ year: 2026, month: 10, day: 25 })).toBe(0);
    expect(weekdayOfLocalDate({ year: 2026, month: 10, day: 24 })).toBe(6);
    expect(weekdayOfLocalDate({ year: 2028, month: 2, day: 29 })).toBe(2);
  });
});

describe("@repo/domain/form 純日曆:月份", () => {
  it("parseLocalMonth / localMonthText:YYYY-MM 互換,格式不對 → null", () => {
    expect(parseLocalMonth("2026-01")).toEqual({ year: 2026, month: 1 });
    expect(localMonthText({ year: 2026, month: 1 })).toBe("2026-01");
    for (const value of [
      "2026-13",
      "2026-00",
      "2026-1",
      "2026-01-01",
      "",
      null,
    ]) {
      expect(parseLocalMonth(value)).toBeNull();
    }
  });

  it("addLocalMonths:跨年進退", () => {
    expect(addLocalMonths({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(addLocalMonths({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(addLocalMonths({ year: 2026, month: 5 }, -17)).toEqual({
      year: 2024,
      month: 12,
    });
    expect(addLocalMonths({ year: 2026, month: 5 }, 0)).toEqual({
      year: 2026,
      month: 5,
    });
  });

  it("daysInLocalMonth / datesOfLocalMonth:閏年 2 月 29 天,由 1 日排到月底", () => {
    expect(daysInLocalMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInLocalMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInLocalMonth({ year: 2026, month: 4 })).toBe(30);
    const dates = datesOfLocalMonth({ year: 2028, month: 2 });
    expect(dates).toHaveLength(29);
    expect(dates[0]).toEqual({ year: 2028, month: 2, day: 1 });
    expect(dates.at(-1)).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe("@repo/domain/form 期間 → 時點區間(半開)", () => {
  it("localDayRange:[from 00:00, to 隔天 00:00)", () => {
    const range = localDayRange(
      { year: 2026, month: 10, day: 1 },
      { year: 2026, month: 10, day: 24 },
      TAIPEI,
    );
    expect(iso(range.from)).toBe("2026-09-30T16:00:00.000Z");
    expect(iso(range.to)).toBe("2026-10-24T16:00:00.000Z");
  });

  it("localDayRange:同一天 = 那一整天", () => {
    const day = { year: 2026, month: 10, day: 24 };
    const range = localDayRange(day, day, TAIPEI);
    expect(range.to - range.from).toBe(24 * 60 * 60_000);
  });

  it("localMonthRange:[月初 00:00, 下月初 00:00),跨年也對", () => {
    const range = localMonthRange({ year: 2026, month: 12 }, TAIPEI);
    expect(iso(range.from)).toBe("2026-11-30T16:00:00.000Z");
    expect(iso(range.to)).toBe("2026-12-31T16:00:00.000Z");
  });

  it("localMonthRange:夏令時間開始的月份,邊界仍是當地 00:00", () => {
    // 紐約 3 月:月初 EST(-05:00)、下月初 EDT(-04:00)
    const range = localMonthRange({ year: 2026, month: 3 }, NEW_YORK);
    expect(iso(range.from)).toBe("2026-03-01T05:00:00.000Z");
    expect(iso(range.to)).toBe("2026-04-01T04:00:00.000Z");
  });

  it("午夜不存在的時區(聖地牙哥 9/6 00:00 開始夏令時間)→ 迄 = 隔天的第一個時點", () => {
    const range = localDayRange(
      { year: 2026, month: 9, day: 5 },
      { year: 2026, month: 9, day: 5 },
      "America/Santiago",
    );
    expect(range.to).toBe(
      startOfLocalDay({ year: 2026, month: 9, day: 6 }, "America/Santiago"),
    );
    expect(localDateOf(range.to, "America/Santiago").day).toBe(6);
    expect(localDateOf(range.to - 1000, "America/Santiago").day).toBe(5);
  });

  it("起日本身 00:00 不存在(聖地牙哥 9/6)→ 迄仍是隔天 00:00,那天只有 23 小時", () => {
    // 不能從起點時點往後加一天(01:00 + 1 天 = 隔天 01:00,會多吃隔天一小時)
    const day = { year: 2026, month: 9, day: 6 };
    const range = localDayRange(day, day, "America/Santiago");
    expect(
      formatTemporal(new Date(range.to), {
        type: "datetime",
        timezone: "America/Santiago",
      }),
    ).toBe("2026-09-07 00:00");
    expect(range.to - range.from).toBe(23 * 60 * 60_000);
  });
});

describe("@repo/domain/form 月份:每月 N 日、時點 → 月份、月份差", () => {
  it("clampedDateOfMonth:超過月底用月底(2 月平年 / 閏年、小月),月內照原日", () => {
    expect(clampedDateOfMonth({ year: 2026, month: 2 }, 31)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(clampedDateOfMonth({ year: 2028, month: 2 }, 30)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(clampedDateOfMonth({ year: 2026, month: 4 }, 31)).toEqual({
      year: 2026,
      month: 4,
      day: 30,
    });
    expect(clampedDateOfMonth({ year: 2026, month: 12 }, 31)).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
    expect(clampedDateOfMonth({ year: 2026, month: 3 }, 15)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
    });
    expect(clampedDateOfMonth({ year: 2026, month: 3 }, 0).day).toBe(1);
  });

  it("clampedDateOfMonth:配 addLocalMonths 跨年(1/31 的下個月是 2/28,12 月往後是隔年 1 月)", () => {
    expect(
      clampedDateOfMonth(addLocalMonths({ year: 2026, month: 1 }, 1), 31),
    ).toEqual({ year: 2026, month: 2, day: 28 });
    expect(
      clampedDateOfMonth(addLocalMonths({ year: 2026, month: 12 }, 1), 31),
    ).toEqual({ year: 2027, month: 1, day: 31 });
  });

  it("localMonthOf:跨年邊界照租戶時區(UTC 還在 12 月,台北已經 1 月)", () => {
    expect(localMonthOf(Date.parse("2026-12-31T16:00:00Z"), TAIPEI)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(localMonthOf(Date.parse("2026-12-31T15:59:59Z"), TAIPEI)).toEqual({
      year: 2026,
      month: 12,
    });
  });

  it("localMonthOf:閏年 2 月底", () => {
    expect(localMonthOf(Date.parse("2028-02-29T15:59:59Z"), TAIPEI)).toEqual({
      year: 2028,
      month: 2,
    });
    expect(localMonthOf(Date.parse("2028-02-29T16:00:00Z"), TAIPEI)).toEqual({
      year: 2028,
      month: 3,
    });
  });

  it("localMonthOf:夏令時間開始的月份,月底邊界用當時的位移(紐約 EDT -04:00)", () => {
    // 3/31 23:30 EDT = 4/1 03:30Z;4/1 00:00 EDT = 4/1 04:00Z
    expect(localMonthOf(Date.parse("2026-04-01T03:30:00Z"), NEW_YORK)).toEqual({
      year: 2026,
      month: 3,
    });
    expect(localMonthOf(Date.parse("2026-04-01T04:00:00Z"), NEW_YORK)).toEqual({
      year: 2026,
      month: 4,
    });
  });

  it("localMonthDiff:to − from 的月數,跨年、同月、往前", () => {
    expect(
      localMonthDiff({ year: 2025, month: 12 }, { year: 2026, month: 1 }),
    ).toBe(1);
    expect(
      localMonthDiff({ year: 2026, month: 1 }, { year: 2025, month: 12 }),
    ).toBe(-1);
    expect(
      localMonthDiff({ year: 2026, month: 2 }, { year: 2026, month: 2 }),
    ).toBe(0);
    expect(
      localMonthDiff({ year: 2024, month: 2 }, { year: 2026, month: 3 }),
    ).toBe(25);
  });

  it("localMonthDiff 與 addLocalMonths 互為反運算", () => {
    const from = { year: 2026, month: 11 };
    for (const amount of [-14, -1, 0, 1, 3, 26]) {
      expect(localMonthDiff(from, addLocalMonths(from, amount))).toBe(amount);
    }
  });
});

describe("@repo/domain/form 純日曆與區間:補跨年、2 月、夏令時間", () => {
  it("localDateDiff:跨年、跨閏年 2 月、跨夏令時間切換日都是日曆日數", () => {
    expect(
      localDateDiff(
        { year: 2026, month: 12, day: 30 },
        { year: 2027, month: 1, day: 2 },
      ),
    ).toBe(3);
    expect(
      localDateDiff(
        { year: 2028, month: 2, day: 28 },
        { year: 2028, month: 3, day: 1 },
      ),
    ).toBe(2);
    expect(
      localDateDiff(
        { year: 2026, month: 3, day: 7 },
        { year: 2026, month: 3, day: 9 },
      ),
    ).toBe(2);
  });

  it("weekdayOfLocalDate:跨年、夏令時間切換日", () => {
    expect(weekdayOfLocalDate({ year: 2026, month: 12, day: 31 })).toBe(4);
    expect(weekdayOfLocalDate({ year: 2027, month: 1, day: 1 })).toBe(5);
    expect(weekdayOfLocalDate({ year: 2026, month: 3, day: 8 })).toBe(0);
  });

  it("addLocalMonths:經過 2 月不受天數影響", () => {
    expect(addLocalMonths({ year: 2028, month: 1 }, 1)).toEqual({
      year: 2028,
      month: 2,
    });
    expect(addLocalMonths({ year: 2028, month: 2 }, 12)).toEqual({
      year: 2029,
      month: 2,
    });
  });

  it("datesOfLocalMonth:12 月排到 31 日,不跨到隔年", () => {
    const dates = datesOfLocalMonth({ year: 2026, month: 12 });
    expect(dates).toHaveLength(31);
    expect(dates.at(-1)).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it("instantOfLocalHhMm:跨年前一刻、閏日", () => {
    expect(
      iso(
        instantOfLocalHhMm({ year: 2026, month: 12, day: 31 }, "23:30", TAIPEI),
      ),
    ).toBe("2026-12-31T15:30:00.000Z");
    expect(
      iso(
        instantOfLocalHhMm({ year: 2028, month: 2, day: 29 }, "08:00", TAIPEI),
      ),
    ).toBe("2028-02-29T00:00:00.000Z");
  });

  it("localDayRange:迄日是年底 → 隔年 1/1 00:00;閏年 2/28–2/29 是兩整天", () => {
    const yearEnd = { year: 2026, month: 12, day: 31 };
    expect(iso(localDayRange(yearEnd, yearEnd, TAIPEI).to)).toBe(
      "2026-12-31T16:00:00.000Z",
    );
    const leap = localDayRange(
      { year: 2028, month: 2, day: 28 },
      { year: 2028, month: 2, day: 29 },
      TAIPEI,
    );
    expect(iso(leap.to)).toBe("2028-02-29T16:00:00.000Z");
    expect(leap.to - leap.from).toBe(2 * 24 * 60 * 60_000);
  });

  it("localDayRange:夏令時間開始 / 結束那天是 23 / 25 小時(紐約)", () => {
    const start = { year: 2026, month: 3, day: 8 };
    const end = { year: 2026, month: 11, day: 1 };
    const short = localDayRange(start, start, NEW_YORK);
    const long = localDayRange(end, end, NEW_YORK);
    expect(short.to - short.from).toBe(23 * 60 * 60_000);
    expect(long.to - long.from).toBe(25 * 60 * 60_000);
  });

  it("localMonthRange:閏年 2 月 29 天、夏令時間結束的月份(紐約 11 月)", () => {
    const february = localMonthRange({ year: 2028, month: 2 }, TAIPEI);
    expect(february.to - february.from).toBe(29 * 24 * 60 * 60_000);
    const november = localMonthRange({ year: 2026, month: 11 }, NEW_YORK);
    expect(iso(november.from)).toBe("2026-11-01T04:00:00.000Z");
    expect(iso(november.to)).toBe("2026-12-01T05:00:00.000Z");
  });
});
