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

const dateColumn = (date: { background?: string; disabled?: boolean }) =>
  buildRosterColumns<Person>({
    leadingColumns: [{ key: "person", header: "人員" }],
    trailingColumns: [],
    dates: [{ date: "2026-11-01", header: "11/1", ...date }],
    dateColumnWidth: 96,
    renderDateCell: () => null,
    columnGroups: [],
    collapsedColumnGroups: [],
    columnVisibility: undefined,
    onToggleGroup: () => {
      // 不測切換
    },
  }).find((column) => column.key === "2026-11-01");

describe("日期欄的背景色", () => {
  it("沒給:格子紙色、表頭不改", () => {
    const column = dateColumn({});
    expect(column?.cellSx).toMatchObject({ bgcolor: "background.paper" });
    expect(column?.headerSx).toEqual({});
  });

  it("給了:表頭與格子都鋪這個顏色", () => {
    const column = dateColumn({ background: "info.lighter" });
    expect(column?.cellSx).toMatchObject({ bgcolor: "info.lighter" });
    expect(column?.headerSx).toEqual({ bgcolor: "info.lighter" });
  });

  it("同時停用:停用色疊在背景色上", () => {
    const column = dateColumn({ background: "info.lighter", disabled: true });
    expect(column?.cellSx).toMatchObject({
      bgcolor: "info.lighter",
      backgroundImage: expect.any(Function),
    });
    expect(column?.headerSx).toMatchObject({
      bgcolor: "info.lighter",
      backgroundImage: expect.any(Function),
    });
  });
});
