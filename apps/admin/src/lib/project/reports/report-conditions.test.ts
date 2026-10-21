import { describe, expect, it } from "@jest/globals";

import {
  type ReportConditionsState,
  type ResolvedReportConditions,
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

  it("其他條件:留這張報表宣告的全部(含別種期間類型的);值型別不合或不是選項 → 預設、沒宣告的丟掉", () => {
    expect(
      resolveConditions(
        { conditions },
        state({
          period: { kind: "week", date: "" },
          extra: { alignDailyClose: true, cashPoint: "nope", stale: true },
        }),
        TODAY,
      ).extra,
    ).toEqual({ alignDailyClose: true, cashPoint: "all" });
    expect(
      resolveConditions(
        { conditions },
        state({ extra: { alignDailyClose: "yes", cashPoint: "counter" } }),
        TODAY,
      ).extra,
    ).toEqual({ alignDailyClose: false, cashPoint: "counter" });
  });

  it("日勾選 → 切週 → 切回日:勾選仍在(頁面每次把整理後的條件寫回網址)", () => {
    // 照 ReportWorkspace 的流程:網址狀態 → resolveConditions → 改一個值 → 整包寫回網址
    let url: ReportConditionsState = state({
      period: { kind: "day", date: "2026-10-16" },
      orgIds: ["a"],
    });
    const change = (
      patch: (resolved: ResolvedReportConditions) => ResolvedReportConditions,
    ) => {
      url = patch(resolveConditions({ conditions }, url, TODAY));
    };

    change((resolved) => ({
      ...resolved,
      extra: { ...resolved.extra, alignDailyClose: true },
    }));
    change((resolved) => ({
      ...resolved,
      period: { kind: "week", date: resolved.period.date },
    }));
    const week = resolveConditions({ conditions }, url, TODAY);
    expect(week.extra.alignDailyClose).toBe(true);
    // 週的查詢不送「對齊日結」
    expect(
      reportQueryInputOf({ conditions }, week, "Asia/Taipei"),
    ).not.toHaveProperty("alignDailyClose");

    change((resolved) => ({
      ...resolved,
      period: { kind: "day", date: resolved.period.date },
    }));
    const day = resolveConditions({ conditions }, url, TODAY);
    expect(day.extra.alignDailyClose).toBe(true);
    expect(
      reportQueryInputOf({ conditions }, day, "Asia/Taipei"),
    ).toMatchObject({ alignDailyClose: true });
  });
});

describe("reportQueryInputOf", () => {
  it("起訖換成租戶時區的時點,其他條件攤平進 input", () => {
    expect(
      reportQueryInputOf(
        { conditions },
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
      // 沒值的條件送預設
      cashPoint: "all",
    });
  });

  it("沒選分店 → null(不能查)", () => {
    expect(
      reportQueryInputOf(
        { conditions },
        { period: { kind: "day", date: TODAY }, orgIds: [], extra: {} },
        "Asia/Taipei",
      ),
    ).toBeNull();
  });
});
