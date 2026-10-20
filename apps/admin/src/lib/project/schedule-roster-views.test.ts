import { describe, expect, it } from "@jest/globals";

import {
  type CountLabels,
  type DemandWording,
  dayCardTexts,
  dayGroupTitle,
  dayWorstTones,
  entryOffsetsOf,
  monthTagLines,
  moreListLine,
  rosterDateOf,
  weekDatesOf,
  weekFullTitle,
  weekListLine,
  weekReadRangeOf,
  weekShortTitle,
} from "./schedule-roster-views";
import { at } from "./schedule-roster-views-test-support";

const LABELS: CountLabels = {
  short: { leader: "負", helper: "協" },
  long: { leader: "負責", helper: "協同" },
};

// ---- 人數寫法(規格 14.5「人數寫法」表) ----

const wording = (
  overrides: Partial<DemandWording> &
    Pick<DemandWording, "counts"> &
    Partial<Pick<DemandWording, "shortName">>,
): DemandWording => ({
  shortName: "早",
  name: "早班",
  time: "08:30–14:30",
  position: "店內櫃台",
  ...overrides,
});
const counts = (
  leaderFilled: number,
  leaderTotal: number,
  helperFilled: number,
  helperTotal: number,
) => ({ leaderFilled, leaderTotal, helperFilled, helperTotal });

describe("人數寫法", () => {
  it("月檢視標籤(電腦):簡稱 + 時間,下一行人數;只有協同時同一行、只有負責仍兩行", () => {
    expect(
      monthTagLines(
        wording({ counts: counts(1, 1, 1, 2) }),
        "desktop",
        LABELS.short,
      ),
    ).toEqual(["早 08:30–14:30", "負1/1 協1/2"]);
    expect(
      monthTagLines(
        wording({
          shortName: "補",
          time: "13:00–17:00",
          counts: counts(0, 0, 1, 1),
        }),
        "desktop",
        LABELS.short,
      ),
    ).toEqual(["補 13:00–17:00 協1/1"]);
    expect(
      monthTagLines(
        wording({
          shortName: "晚",
          time: "14:30–22:00",
          counts: counts(1, 1, 0, 0),
        }),
        "desktop",
        LABELS.short,
      ),
    ).toEqual(["晚 14:30–22:00", "負1/1"]);
  });

  it("月檢視標籤(平板):有負責人且已滿只寫簡稱 + 已填 / 總筆數;未滿、只有協同、臨時寫完整兩行", () => {
    expect(
      monthTagLines(
        wording({ counts: counts(1, 1, 1, 1) }),
        "tablet",
        LABELS.short,
      ),
    ).toEqual(["早 2/2"]);
    expect(
      monthTagLines(
        wording({
          shortName: "晚",
          time: "14:30–22:00",
          counts: counts(1, 1, 0, 1),
        }),
        "tablet",
        LABELS.short,
      ),
    ).toEqual(["晚 14:30–22:00", "負1/1 協0/1"]);
    expect(
      monthTagLines(
        wording({
          shortName: "補",
          time: "13:00–17:00",
          counts: counts(0, 0, 1, 1),
        }),
        "tablet",
        LABELS.short,
      ),
    ).toEqual(["補 13:00–17:00", "協1/1"]);
  });

  it("班表人力需求區 / 「+N」清單浮層:「晚 14:30–22:00 負1/1 協0/1」", () => {
    expect(
      moreListLine(
        wording({
          shortName: "晚",
          time: "14:30–22:00",
          counts: counts(1, 1, 0, 1),
        }),
        LABELS.short,
      ),
    ).toBe("晚 14:30–22:00 負1/1 協0/1");
  });

  it("週檢視容器標題:直排簡稱 + 已填 / 總筆數;滑過提示完整標題", () => {
    const item = wording({ position: "櫃台 A", counts: counts(1, 1, 2, 2) });
    expect(weekShortTitle(item)).toEqual({ shortName: "早", count: "3/3" });
    expect(weekFullTitle(item, LABELS.short)).toBe(
      "早班 · 櫃台 A 08:30–14:30 · 負1/1 協2/2",
    );
  });

  it("日檢視容器標題:班名 · 崗位 時間 · 負責 x/y · 協同 x/y", () => {
    expect(
      dayGroupTitle(wording({ counts: counts(1, 1, 1, 1) }), LABELS.long),
    ).toBe("早班 · 店內櫃台 08:30–14:30 · 負責 1/1 · 協同 1/1");
  });

  it("手機日檢視卡片:標題、副標、右上已填 / 總筆數,有缺時缺幾人", () => {
    expect(
      dayCardTexts(wording({ counts: counts(1, 1, 1, 1) }), LABELS.long),
    ).toEqual({
      title: "早班 08:30–14:30",
      subtitle: "店內櫃台 · 負責 1/1 · 協同 1/1",
      badge: "2/2",
      missing: 0,
    });
    expect(
      dayCardTexts(wording({ counts: counts(1, 1, 0, 1) }), LABELS.long),
    ).toMatchObject({ badge: "1/2", missing: 1 });
  });

  it("手機週檢視(7 天清單):各人力需求的簡稱 + 已填 / 總筆數,用「 · 」分隔", () => {
    expect(
      weekListLine([
        wording({ counts: counts(1, 1, 1, 1) }),
        wording({ shortName: "晚", counts: counts(1, 1, 0, 1) }),
      ]),
    ).toBe("早 2/2 · 晚 1/2");
  });

  it("手機卡片的加註:上班比需求早 30 分 → -30;下班比需求晚 30 分 → +30", () => {
    expect(
      entryOffsetsOf(
        { startAt: at(8), endAt: at(15) },
        { startAt: at(8.5), endAt: at(14.5) },
      ),
    ).toEqual({ start: -30, end: 30 });
  });
});

describe("日期", () => {
  it("一週從星期日開始;跨月的週要多讀那幾天", () => {
    expect(weekDatesOf("2026-11-11")).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
    expect(weekReadRangeOf("2026-11-11", "2026-11")).toBeNull();
    expect(weekReadRangeOf("2026-11-30", "2026-11")).toEqual({
      from: "2026-11-29",
      to: "2026-12-05",
    });
  });

  it("網址的日期不在這個月 / 不合法 → 今天(這個月)或 1 日", () => {
    expect(rosterDateOf("2026-11-05", "2026-11", "2026-10-21")).toBe(
      "2026-11-05",
    );
    expect(rosterDateOf("2026-12-05", "2026-11", "2026-11-21")).toBe(
      "2026-11-21",
    );
    expect(rosterDateOf("2026-11-31", "2026-11", "2026-10-21")).toBe(
      "2026-11-01",
    );
  });
});

/** 一筆人力需求:第一筆是負責、其餘協同;`filled` 依序表示有沒有人填。 */
const dotDemand = (id: string, date: string, filled: boolean[]) => ({
  id,
  date,
  startAt: at(8),
  endAt: at(12),
  positionKey: "p",
  tasks: filled.map((isFilled, index) => ({
    taskId: `${id}-${String(index)}`,
    role: index === 0 ? "leader" : "helper",
    entryId: isFilled ? `e-${id}-${String(index)}` : null,
  })),
});

describe("選日期月曆的點", () => {
  it("當天最嚴重的狀態:有缺負責紅、只缺協同橘、排滿不畫", () => {
    const tones = dayWorstTones([
      dotDemand("a", "2026-11-01", [true, false]),
      dotDemand("b", "2026-11-01", [false, true]),
      dotDemand("c", "2026-11-02", [true, false]),
      dotDemand("d", "2026-11-02", [true, true]),
      dotDemand("e", "2026-11-03", [true, true]),
    ]);
    expect([...tones.entries()]).toEqual([
      ["2026-11-01", "error"],
      ["2026-11-02", "warning"],
    ]);
  });
});
