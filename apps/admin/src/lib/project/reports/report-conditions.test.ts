import { describe, expect, it } from "@jest/globals";

import {
  type ReportConditionsState,
  reportQueryInputOf,
  resolveConditions,
} from "./report-conditions";
import type { ReportConditions } from "./report-registry";

const TODAY = "2026-10-20";

const conditions: ReportConditions = {
  period: ["day", "week", "month"],
  orgs: { max: 2 },
  extra: [
    {
      key: "alignDailyClose",
      type: "boolean",
      label: "x",
      only: "day",
    },
    {
      key: "cashPoint",
      type: "select",
      label: "x",
      options: [
        { value: "all", label: "x" },
        { value: "counter", label: "x" },
      ],
    },
  ],
};

const state = (
  patch: Partial<ReportConditionsState> = {},
): ReportConditionsState => ({
  period: { kind: "day", date: "" },
  orgIds: [],
  extra: {},
  ...patch,
});

describe("resolveConditions", () => {
  it("預設:今天、沒選分店、其他條件用預設值", () => {
    expect(resolveConditions({ conditions }, state(), TODAY)).toEqual({
      period: { kind: "day", date: TODAY },
      orgIds: [],
      extra: { alignDailyClose: false, cashPoint: "all" },
    });
  });

  it("期間類型不在這張報表 → 換成第一種;日期整理成期間起點", () => {
    expect(
      resolveConditions(
        { conditions: { ...conditions, period: ["week", "month"] } },
        state({ period: { kind: "day", date: "2026-10-14" } }),
        TODAY,
      ).period,
    ).toEqual({ kind: "week", date: "2026-10-11" });
  });

  it("分店去重、超過上限只留前面的", () => {
    expect(
      resolveConditions(
        { conditions },
        state({ orgIds: ["a", "a", "b", "c"] }),
        TODAY,
      ).orgIds,
    ).toEqual(["a", "b"]);
  });

  it("其他條件:只留這種期間類型下有的;值型別不合或不是選項 → 預設", () => {
    expect(
      resolveConditions(
        { conditions },
        state({
          period: { kind: "week", date: "" },
          extra: { alignDailyClose: true, cashPoint: "nope", stale: true },
        }),
        TODAY,
      ).extra,
    ).toEqual({ cashPoint: "all" });
    expect(
      resolveConditions(
        { conditions },
        state({ extra: { alignDailyClose: true, cashPoint: "counter" } }),
        TODAY,
      ).extra,
    ).toEqual({ alignDailyClose: true, cashPoint: "counter" });
  });
});

describe("reportQueryInputOf", () => {
  it("起訖換成租戶時區的時點,其他條件攤平進 input", () => {
    expect(
      reportQueryInputOf(
        {
          period: { kind: "day", date: "2026-10-16" },
          orgIds: ["a"],
          extra: { alignDailyClose: true },
        },
        "Asia/Taipei",
      ),
    ).toEqual({
      periodKind: "day",
      from: "2026-10-15T16:00:00.000Z",
      to: "2026-10-16T16:00:00.000Z",
      orgIds: ["a"],
      alignDailyClose: true,
    });
  });

  it("沒選分店 → null(不能查)", () => {
    expect(
      reportQueryInputOf(
        { period: { kind: "day", date: TODAY }, orgIds: [], extra: {} },
        "Asia/Taipei",
      ),
    ).toBeNull();
  });
});
