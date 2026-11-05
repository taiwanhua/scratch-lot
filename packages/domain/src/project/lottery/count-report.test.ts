import { describe, expect, it } from "@jest/globals";

import {
  type CountModeHistoryRow,
  type MatchCostEvent,
  countModePeriodNotesOf,
  countReportEstimatedOf,
  matchCostSplitOf,
  monthEndUnrenumberedOf,
} from "./count-report";

const at = (text: string) => new Date(`${text}+08:00`);

const onHand = (status = "unsold") => ({ status, onHand: status === "unsold" });

/** 一對對號:刷到的 X(成本 cX)從 `scannedFrom` 換成未售,配對張 Y(成本 cY)從未售換成 `scannedFrom`。 */
const pair = (
  scannedFrom: string,
  cX: number,
  cY: number,
): MatchCostEvent[] => [
  { cost: cX, from: onHand(scannedFrom), to: onHand("unsold") },
  { cost: cY, from: onHand("unsold"), to: onHand(scannedFrom) },
];

describe("matchCostSplitOf(對號成本差怎麼分,11.2、RP1)", () => {
  it.each([
    {
      name: "配對張接手已售:差額換進已售成本、調整列 0",
      events: pair("sold", 184, 200),
      expected: { onHand: -16, sold: 16, investigating: 0, lost: 0, adjust: 0 },
    },
    {
      name: "配對張接手待查:差額列在對號成本調整",
      events: pair("investigating", 184, 200),
      expected: {
        onHand: -16,
        sold: 0,
        investigating: 16,
        lost: 0,
        adjust: -16,
      },
    },
    {
      name: "配對張接手遺失:差額列在對號成本調整、遺失損失跟著調",
      events: pair("lost", 200, 184),
      expected: {
        onHand: 16,
        sold: 0,
        investigating: 0,
        lost: -16,
        adjust: 16,
      },
    },
    {
      name: "同成本或只換位置(兩張都未售):全部 0",
      events: [
        ...pair("sold", 184, 184),
        { cost: 184, from: onHand(), to: onHand() },
        { cost: 200, from: onHand(), to: onHand() },
      ],
      expected: { onHand: 0, sold: 0, investigating: 0, lost: 0, adjust: 0 },
    },
  ])("$name", ({ events, expected }) => {
    expect(matchCostSplitOf(events)).toEqual(expected);
  });
});

describe("countReportEstimatedOf(估算的判斷,11.1、RP4)", () => {
  const periodEnd = at("2026-11-02T00:00");
  it.each([
    {
      name: "這一期沒有未對號事件 → 不是估算",
      unmatched: [],
      approved: [],
      expected: false,
    },
    {
      name: "有未對號事件、沒有補點 → 估算",
      unmatched: ["2026-11-01T10:00"],
      approved: [],
      expected: true,
    },
    {
      name: "補點核准晚於最後一筆未對號事件(期末前)→ 不是估算",
      unmatched: ["2026-11-01T10:00"],
      approved: ["2026-11-01T22:00"],
      expected: false,
    },
    {
      name: "補點核准和自動對號同一刻 → 不是估算",
      unmatched: ["2026-11-01T22:00"],
      approved: ["2026-11-01T22:00"],
      expected: false,
    },
    {
      name: "補點之後又依張數賣 → 估算",
      unmatched: ["2026-11-01T10:00", "2026-11-01T23:00"],
      approved: ["2026-11-01T22:00"],
      expected: true,
    },
    {
      name: "期末之後才補點 → 這一期仍是估算(重跑不變)",
      unmatched: ["2026-11-01T10:00"],
      approved: ["2026-11-02T09:00"],
      expected: true,
    },
  ])("$name", ({ unmatched, approved, expected }) => {
    expect(
      countReportEstimatedOf({
        unmatchedAts: unmatched.map((text) => at(text)),
        renumberApprovedAts: approved.map((text) => at(text)),
        periodEnd,
      }),
    ).toBe(expected);
  });
});

describe("countModePeriodNotesOf(區塊 8 盤點制度與補點編號,11.4、RP4)", () => {
  const history: CountModeHistoryRow[] = [
    {
      from: "numbered",
      to: "count",
      at: at("2026-10-01T09:00"),
      cause: "setting",
    },
    {
      from: "count",
      to: "count",
      at: at("2026-10-05T22:00"),
      cause: "renumber_approved",
    },
    {
      from: "count",
      to: "converting",
      at: at("2026-11-15T10:00"),
      cause: "setting",
    },
  ];

  it("期間內沒換制度:期初制度 + 從什麼時候起、補點次數、距上次補點天數", () => {
    expect(
      countModePeriodNotesOf(history, "converting", {
        from: at("2026-10-16T00:00"),
        to: at("2026-10-17T00:00"),
      }),
    ).toEqual({
      countStore: true,
      modeAtStart: "count",
      since: at("2026-10-01T09:00"),
      modeAtEnd: "count",
      changes: [],
      renumberAts: [],
      lastRenumberAt: at("2026-10-05T22:00"),
      daysSinceRenumber: 11,
    });
  });

  it("期間內換制度與補點:列出切換時間、補點次數", () => {
    const notes = countModePeriodNotesOf(history, "converting", {
      from: at("2026-10-01T00:00"),
      to: at("2026-12-01T00:00"),
    });
    expect(notes).toMatchObject({
      countStore: true,
      modeAtStart: "numbered",
      since: null,
      modeAtEnd: "converting",
      changes: [
        { at: at("2026-10-01T09:00"), from: "numbered", to: "count" },
        { at: at("2026-11-15T10:00"), from: "count", to: "converting" },
      ],
      renumberAts: [at("2026-10-05T22:00")],
    });
  });

  it("編號店(沒有歷程)→ 不是張數店、沒有補點", () => {
    expect(
      countModePeriodNotesOf([], "numbered", {
        from: at("2026-10-01T00:00"),
        to: at("2026-11-01T00:00"),
      }),
    ).toMatchObject({
      countStore: false,
      modeAtStart: "numbered",
      changes: [],
      lastRenumberAt: null,
      daysSinceRenumber: null,
    });
  });

  it("期間之後才改成張數 → 這一期不是張數店(重跑舊報表不變)", () => {
    expect(
      countModePeriodNotesOf(history, "converting", {
        from: at("2026-09-01T00:00"),
        to: at("2026-10-01T00:00"),
      }),
    ).toMatchObject({ countStore: false, modeAtStart: "numbered" });
  });
});

describe("monthEndUnrenumberedOf(月底未補點編號,第 10 節、RP4)", () => {
  const closes = [
    {
      month: "2026-09",
      periodEnd: at("2026-10-01T00:00"),
      renumber: { mode: "count" as const, done: false },
    },
    {
      month: "2026-10",
      periodEnd: at("2026-11-01T00:00"),
      renumber: { mode: "count" as const, done: true },
    },
    {
      month: "2026-11",
      periodEnd: at("2026-12-01T00:00"),
      renumber: { mode: "numbered" as const, done: false },
    },
    { month: "2026-12", periodEnd: at("2027-01-01T00:00"), renumber: null },
  ];

  it("只列月底落在期間內、張數或轉換中、沒補點的已關帳月份", () => {
    expect(
      monthEndUnrenumberedOf(closes, {
        from: at("2026-09-01T00:00"),
        to: at("2027-01-01T00:00"),
      }),
    ).toEqual(["2026-09"]);
    expect(
      monthEndUnrenumberedOf(closes, {
        from: at("2026-10-01T00:00"),
        to: at("2026-11-01T00:00"),
      }),
    ).toEqual([]);
  });
});
