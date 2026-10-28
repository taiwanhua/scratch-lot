import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { restoreViewportAfterEach, setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import { ROSTER_LEGEND_ITEMS } from "./roster-legend";
import { rosterPath, setViewportWidth } from "./roster-views-test-support";

setupFakeViewport();
restoreViewportAfterEach();

/** 圖例裡的文字(i18n `admin.schedule.legend.items.*`)。 */
const LEGEND_TEXT = {
  unmatchedPunch: "未對應排班的打卡(張數)",
  closed: "店休",
  temp: "沒有套用範本的人力需求",
  multi: "同一筆排班顧多台",
} as const;

type Probe = keyof typeof LEGEND_TEXT;

/** 在畫面上(圖例以外)找記號:找到 → 圖例要有那一項。 */
const PROBES: Record<Probe, (root: HTMLElement) => HTMLElement[]> = {
  unmatchedPunch: (root) =>
    within(root).queryAllByLabelText(/張未對應排班的打卡/u),
  closed: (root) => within(root).queryAllByText("店休"),
  temp: (root) => within(root).queryAllByText(/^臨/u),
  multi: (root) => within(root).queryAllByText(/×\d/u),
};

const legend = () => screen.getByLabelText("圖例");

/** 畫面上(不含圖例)出現的記號。 */
const drawnMarks = (): Probe[] => {
  const box = legend();
  return (Object.keys(PROBES) as Probe[]).filter((probe) =>
    PROBES[probe](document.body).some((node) => !box.contains(node)),
  );
};

const expectLegendCovers = (marks: readonly Probe[]) => {
  for (const mark of marks) {
    expect(within(legend()).getAllByText(LEGEND_TEXT[mark])).toHaveLength(1);
  }
};

/**
 * 排班表各檢視的圖例(規格 14.5「圖例」):畫面上畫出來的記號都要在同畫面的圖例找到;圖例列的是該檢視
 * **可能**出現的項目(`roster-legend.ts`),不看當下資料。夾具 2026-11:1 / 4 日有未對應排班的打卡、3 日店休、
 * 7 日有臨時加開與 ×2。
 */
describe("排班表:每個檢視畫出的記號都在圖例裡", () => {
  it.each([
    ["週(電腦)", 1440, "view=week&date=2026-11-04", "週檢視"],
    [
      "日(電腦):有未對應排班的打卡的 4 日",
      1440,
      "view=day&date=2026-11-04",
      "日檢視",
    ],
    ["日(電腦):店休的 3 日", 1440, "view=day&date=2026-11-03", "日檢視"],
    [
      "日(電腦):有臨時加開、×2 的 7 日",
      1440,
      "view=day&date=2026-11-07",
      "日檢視",
    ],
  ])("%s", async (_name, width, params, timelineName) => {
    setViewportWidth(width);
    renderSchedulePage({ path: rosterPath(params) });
    const timeline = await screen.findByRole("group", { name: timelineName });
    expect(timeline).toBeInTheDocument();
    await waitFor(() => {
      expect(drawnMarks().length).toBeGreaterThan(0);
    });
    expectLegendCovers(drawnMarks());
  });

  it("週(電腦)這週有 ⏲、店休、臨、×2,都畫出來也都在圖例", async () => {
    setViewportWidth(1440);
    renderSchedulePage({ path: rosterPath("view=week&date=2026-11-04") });
    await screen.findByRole("group", { name: "週檢視" });
    await waitFor(() => {
      expect(drawnMarks()).toEqual([
        "unmatchedPunch",
        "closed",
        "temp",
        "multi",
      ]);
    });
  });

  it.each([
    ["4 日(⏲)", "2026-11-04", ["unmatchedPunch"]],
    ["7 日(臨、×2)", "2026-11-07", ["temp", "multi"]],
  ])(
    "日(手機)%s:卡片清單畫出來的記號都在圖例",
    async (_name, date, expected) => {
      setViewportWidth(390);
      renderSchedulePage({ path: rosterPath(`view=day&date=${date}`) });
      await waitFor(() => {
        expect(drawnMarks()).toEqual(expect.arrayContaining(expected));
      });
      expectLegendCovers(drawnMarks());
    },
  );

  it("日(手機):那天有未對應排班的打卡 → 上方顯示「⏲ 3」(同電腦版)", async () => {
    setViewportWidth(390);
    renderSchedulePage({ path: rosterPath("view=day&date=2026-11-04") });
    expect(
      await screen.findByLabelText("3 張未對應排班的打卡"),
    ).toHaveTextContent("⏲ 3");
  });

  it("週(手機):7 天清單在有未對應排班的打卡的日子旁顯示「⏲ N」;店休、臨、⏲ 都在圖例", async () => {
    setViewportWidth(390);
    renderSchedulePage({ path: rosterPath("view=week&date=2026-11-04") });
    expect(
      await screen.findByLabelText("2 張未對應排班的打卡"),
    ).toHaveTextContent("⏲ 2");
    expect(screen.getByLabelText("3 張未對應排班的打卡")).toBeInTheDocument();
    await waitFor(() => {
      expect(drawnMarks()).toEqual(
        expect.arrayContaining(["unmatchedPunch", "closed", "temp"]),
      );
    });
    expectLegendCovers(drawnMarks());
  });

  it("班表:店休、臨、晚 ×2、時鐘圖示都在圖例;「晚 ×2」的圖例樣本和格子同一種寫法", async () => {
    setViewportWidth(1440);
    renderSchedulePage({ path: rosterPath("view=roster") });
    await screen.findByLabelText("3 張未對應排班的打卡");
    await waitFor(() => {
      expect(drawnMarks()).toEqual(
        expect.arrayContaining(["unmatchedPunch", "closed", "temp", "multi"]),
      );
    });
    expectLegendCovers(drawnMarks());
    expect(within(legend()).getByText("晚 ×2")).toBeInTheDocument();
  });

  it.each([
    ["3 日店休", "2026-11-03", "closed", "店休"],
    ["9 日特殊日", "2026-11-09", "special", "店慶"],
    ["10 日特殊日(沒選顏色)", "2026-11-10", "special", "颱風"],
  ])(
    "日(手機)%s:卡片清單上方標示那天(同電腦版),那天的 ⏲ 放同一列;圖例有這一項",
    async (_name, date, kind, text) => {
      setViewportWidth(390);
      renderSchedulePage({
        path: rosterPath(`view=day&date=${date}`),
        roster: { calendarMarks: true },
      });
      const bar = await waitFor(() => {
        const found = document.querySelector<HTMLElement>(
          `[data-calendar-mark="${CSS.escape(kind)}"]`,
        );
        if (found === null) {
          throw new Error(`找不到 ${kind}`);
        }
        return found;
      });
      expect(within(bar).getByText(text)).toBeInTheDocument();
      if (kind === "closed") {
        expect(
          within(bar).getByLabelText("1 張未對應排班的打卡"),
        ).toHaveTextContent("⏲ 1");
      }
      expect(
        within(legend()).getByText(
          kind === "closed" ? LEGEND_TEXT.closed : "特殊日(行事曆設定的顏色)",
        ),
      ).toBeInTheDocument();
    },
  );

  it("月:特殊日沒選顏色也標名稱(中性的特殊日底色),有選顏色用色票標籤", async () => {
    setViewportWidth(1440);
    renderSchedulePage({
      path: rosterPath("view=month"),
      roster: { calendarMarks: true },
    });
    const typhoon = await screen.findByText("颱風");
    expect(typhoon.closest("[data-palette]")).toHaveAttribute(
      "data-palette",
      "none",
    );
    expect(screen.getByText("店慶").closest("[data-palette]")).toHaveAttribute(
      "data-palette",
      "cyan",
    );
  });

  it("班表:店休的格子有未對應排班的打卡時照樣顯示時鐘圖示(只標示、不能點)", async () => {
    setViewportWidth(1440);
    renderSchedulePage({
      path: rosterPath("view=roster"),
      roster: { calendarMarks: true },
    });
    await screen.findByLabelText("3 張未對應排班的打卡");
    const cell = document.querySelector<HTMLElement>(
      '[data-roster-cell="u-lin|2026-11-03"]',
    );
    if (cell === null) {
      throw new Error("找不到林美麗 3 日的格子");
    }
    const scope = within(cell);
    expect(scope.getByText("店休")).toBeInTheDocument();
    expect(scope.getByLabelText("1 張未對應排班的打卡")).toHaveTextContent(
      "⏲ 1",
    );
    expect(scope.queryByRole("button")).toBeNull();
  });

  it("特殊日:會畫特殊日的檢視都列進圖例(夾具沒有特殊日,照清單核對)", () => {
    for (const view of [
      "week",
      "day",
      "dayMobile",
      "weekMobile",
      "month",
      "monthMobile",
      "dayPicker",
      "grid",
    ] as const) {
      expect(ROSTER_LEGEND_ITEMS[view]).toContain("special");
    }
  });
});
