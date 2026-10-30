import { describe, expect, it } from "@jest/globals";
import { GraphQLError } from "graphql";

import {
  RANGE_TOO_LARGE,
  type ReportRangeInput,
  type ReportRangeRule,
  assertReportRange,
} from "./report-range";

/** 台北 2026-10-16 這一天(迄不含)。 */
const DAY: ReportRangeInput = {
  periodKind: "day",
  from: "2026-10-15T16:00:00.000Z",
  to: "2026-10-16T16:00:00.000Z",
  orgIds: ["org-a", "org-b"],
};

const RULE: ReportRangeRule = { allowed: ["day", "week", "month"], maxOrgs: 2 };

const errorOf = (input: ReportRangeInput, rule = RULE): GraphQLError => {
  try {
    assertReportRange(input, rule);
  } catch (error) {
    if (error instanceof GraphQLError) return error;
    throw error;
  }
  throw new Error("expected assertReportRange to throw");
};

describe("assertReportRange", () => {
  it.each([
    ["日", DAY],
    [
      "週(星期日 00:00 至下週日 00:00)",
      {
        ...DAY,
        periodKind: "week",
        from: "2026-10-10T16:00:00.000Z",
        to: "2026-10-17T16:00:00.000Z",
      },
    ],
    [
      "月(31 天)",
      {
        ...DAY,
        periodKind: "month",
        from: "2026-09-30T16:00:00.000Z",
        to: "2026-10-31T16:00:00.000Z",
      },
    ],
    [
      "日(夏令時間結束那天 25 小時)",
      {
        ...DAY,
        from: "2026-11-01T04:00:00.000Z",
        to: "2026-11-02T05:00:00.000Z",
      },
    ],
    ["Date 物件", { ...DAY, from: new Date(DAY.from), to: new Date(DAY.to) }],
  ])("合格:%s", (_label, input) => {
    expect(() => {
      assertReportRange(input, RULE);
    }).not.toThrow();
  });

  it.each([
    [
      "期間類型不在 allowed",
      { ...DAY, periodKind: "month" },
      { allowed: ["day", "week"], maxOrgs: 2 },
      ["periodKind"],
    ],
    ["不認得的期間類型", { ...DAY, periodKind: "year" }, RULE, ["periodKind"]],
    [
      "組織數超過上限",
      { ...DAY, orgIds: ["org-a", "org-b", "org-c"] },
      RULE,
      ["orgIds"],
    ],
    [
      "日卻帶了兩天的起訖",
      { ...DAY, to: "2026-10-17T16:00:00.000Z" },
      RULE,
      ["from", "to"],
    ],
    [
      "月卻帶了 32 天的起訖",
      {
        ...DAY,
        periodKind: "month",
        from: "2026-09-30T16:00:00.000Z",
        to: "2026-11-01T16:00:00.000Z",
      },
      RULE,
      ["from", "to"],
    ],
  ] as const)("RANGE_TOO_LARGE:%s", (_label, input, rule, fields) => {
    const error = errorOf(input, rule);
    expect(error.extensions).toEqual({
      code: "VALIDATION_FAILED",
      reason: RANGE_TOO_LARGE,
      fields,
    });
  });

  it.each([
    ["沒選組織", { ...DAY, orgIds: [] }, ["orgIds"]],
    ["迄不晚於起", { ...DAY, to: DAY.from }, ["from", "to"]],
    ["不是時點", { ...DAY, from: "昨天" }, ["from", "to"]],
  ] as const)(
    "其他不合法(VALIDATION_FAILED、沒有 reason):%s",
    (_label, input, fields) => {
      expect(errorOf(input).extensions).toEqual({
        code: "VALIDATION_FAILED",
        fields,
      });
    },
  );
});
