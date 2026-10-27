import { describe, expect, it } from "@jest/globals";

import { COLLAPSED_GROUP_WIDTH, buildRosterColumns } from "./roster-columns";

interface Person {
  id: string;
}

const build = (collapsedGroupWidth?: number) =>
  buildRosterColumns<Person>({
    leadingColumns: [{ key: "person", header: "人員" }],
    trailingColumns: [
      { key: "hours", header: "時數" },
      { key: "shifts", header: "班數" },
    ],
    dates: [{ date: "2026-11-01", header: "11/1" }],
    dateColumnWidth: 96,
    renderDateCell: () => null,
    columnGroups: [
      { id: "stats", label: "統計", columnKeys: ["hours", "shifts"] },
    ],
    collapsedColumnGroups: ["stats"],
    columnVisibility: undefined,
    onToggleGroup: () => {
      // 不測切換
    },
    ...(collapsedGroupWidth === undefined ? {} : { collapsedGroupWidth }),
  }).find((column) => column.key.endsWith("stats"));

describe("收合窄欄的寬度", () => {
  it("預設 88、表頭照主題的留白", () => {
    const column = build();
    expect(column?.width).toBe(COLLAPSED_GROUP_WIDTH);
    expect(column?.headerSx).toBeUndefined();
  });

  it("給窄一點的寬度(手機):寬度照給的、表頭左右留白縮小", () => {
    const column = build(52);
    expect(column?.width).toBe(52);
    expect(column?.minWidth).toBe(52);
    expect(column?.headerSx).toEqual({ px: 0.5 });
  });
});
