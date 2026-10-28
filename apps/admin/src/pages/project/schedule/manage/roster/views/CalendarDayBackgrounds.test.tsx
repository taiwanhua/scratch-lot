import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { tagPaletteColorOf } from "@/lib/project/tag-palettes";
import { restoreViewportAfterEach, setupFakeViewport } from "@/test/viewport";

import { renderSchedulePage } from "../../../schedule-test-support";
import { rosterPath, setViewportWidth } from "./roster-views-test-support";

setupFakeViewport();
restoreViewportAfterEach();

/** 那一格所在的表格格子(`td` / `th`)。 */
const tableCellOf = (node: Element | null): HTMLElement => {
  const cell = node?.closest<HTMLElement>("td, th");
  if (cell === null || cell === undefined) {
    throw new Error("找不到表格格子");
  }
  return cell;
};

/**
 * 行事曆標示的底色(規格 14.5「行事曆標示」;共用 `calendarMarkBackground`):
 * 夾具 `calendarMarks`:3 日店休、9 日特殊日「店慶」(cyan)。
 */
describe("排班表:特殊日整欄 / 整格底色", () => {
  it("班表:9 日特殊日表頭與每格鋪色票底色;3 日店休照舊停用、不鋪特殊日色", async () => {
    setViewportWidth(1440);
    renderSchedulePage({
      path: rosterPath("view=roster"),
      roster: { calendarMarks: true },
    });
    const special = await waitFor(() =>
      tableCellOf(
        document.querySelector('[data-roster-cell="u-lin|2026-11-09"]'),
      ),
    );
    expect(special).toHaveStyle({
      backgroundColor: "var(--tag-palette-bg-cyan)",
    });
    const header = tableCellOf(screen.getAllByText("店慶")[0] ?? null);
    expect(header.tagName).toBe("TH");
    expect(header).toHaveStyle({
      backgroundColor: "var(--tag-palette-bg-cyan)",
    });
    const closed = tableCellOf(
      document.querySelector('[data-roster-cell="u-lin|2026-11-03"]'),
    );
    expect(closed).not.toHaveStyle({
      backgroundColor: "var(--tag-palette-bg-cyan)",
    });
  });

  it("月檢視:9 日整格鋪特殊日顏色(底座淡化),名稱標籤保留", async () => {
    setViewportWidth(1440);
    renderSchedulePage({
      path: rosterPath("view=month"),
      roster: { calendarMarks: true },
    });
    const cell = await screen.findByRole("gridcell", {
      name: "11/9(一)(點了切到那天的日檢視)",
    });
    expect(cell).toHaveAttribute("data-background", tagPaletteColorOf("cyan"));
    expect(within(cell).getByText("店慶")).toBeInTheDocument();
  });
});
