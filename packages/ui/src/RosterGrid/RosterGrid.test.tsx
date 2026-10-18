import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { DataTableColumn } from "../DataTable/data-table-column";
import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { setupFakeViewport } from "../test/viewport";
import { RosterGrid, type RosterGridProps } from "./RosterGrid";
import { type DemoStaff, demoDates, demoStaff } from "./roster-grid-story-data";
import type { RosterTopGroup } from "./roster-grid-types";

setupFakeViewport();

const personColumn: DataTableColumn<DemoStaff> = {
  key: "person",
  header: "人員",
  accessor: "name",
};
const statColumns: DataTableColumn<DemoStaff>[] = [
  { key: "hours", header: "時數", accessor: "hours" },
  { key: "shifts", header: "場數", accessor: "shifts" },
];

const renderRoster = (props: Partial<RosterGridProps<DemoStaff>> = {}) =>
  render(
    <RosterGrid
      people={demoStaff(3)}
      getPersonKey={(person) => person.id}
      dates={demoDates(3, [2])}
      leadingColumns={[personColumn]}
      trailingColumns={statColumns}
      renderCell={({ person, date }) => `${person.name}@${date}`}
      formatCellLabel={(person, date) => `${person.name} ${date}`}
      aria-label="人員排程"
      {...props}
    />,
  );

const headerTexts = () =>
  screen.getAllByRole("columnheader").map((cell) => cell.textContent);
const rulesOf = (element: Element) =>
  cssRulesMatching(`.${emotionClassOf(element)}`);
const cellOf = (text: string) => {
  const cell = screen.getByText(text).closest("td");
  if (cell === null) throw new Error(`「${text}」不在 td 裡`);
  return cell;
};

describe("RosterGrid 版面", () => {
  it("左固定人員欄 → 日期欄 → 右固定統計欄;格子內容由使用處決定", () => {
    renderRoster();

    expect(headerTexts()).toEqual([
      "人員",
      "10/1 四",
      "10/2 五 · 公休",
      "10/3 六",
      "時數",
      "場數",
    ]);
    expect(screen.getByText("王小明@2026-10-01")).toBeInTheDocument();
  });

  it("左右固定欄是 sticky(橫向捲動時不動),日期欄不是", () => {
    renderRoster();

    const left = rulesOf(cellOf("王小明"));
    expect(declaredValue(left, "position")).toBe("sticky");
    expect(declaredValue(left, "left")).toBe("0");
    const right = rulesOf(cellOf("15"));
    expect(declaredValue(right, "position")).toBe("sticky");
    expect(declaredValue(right, "right")).toBe("0");
    expect(
      declaredValue(rulesOf(cellOf("王小明@2026-10-01")), "position"),
    ).toBeNull();
  });
});

describe("RosterGrid 選取", () => {
  it("點格子回報人員與日期;選取中的格子標 aria-pressed", async () => {
    const onCellClick = jest.fn();
    renderRoster({
      onCellClick,
      selectedCell: { personKey: "s2", date: "2026-10-03" },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "王小明 2026-10-01" }),
    );
    expect(onCellClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      "2026-10-01",
    );
    expect(
      screen.getByRole("button", { name: "李小華 2026-10-03" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "王小明 2026-10-03" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("停用的日期(公休)格子不能點", () => {
    renderRoster({ onCellClick: jest.fn() });

    expect(
      screen.queryByRole("button", { name: "王小明 2026-10-02" }),
    ).toBeNull();
  });
});

describe("RosterGrid 欄位顯示 / 隱藏(受控)", () => {
  it("取消一欄:元件不自己存,畫面照外部傳入的 columnVisibility", () => {
    const { rerender } = renderRoster({ columnVisibility: {} });
    expect(headerTexts()).toContain("時數");

    rerender(
      <RosterGrid
        people={demoStaff(3)}
        getPersonKey={(person) => person.id}
        dates={demoDates(3, [2])}
        leadingColumns={[personColumn]}
        trailingColumns={statColumns}
        renderCell={() => null}
        columnVisibility={{ hours: false, "2026-10-03": false }}
      />,
    );
    expect(headerTexts()).toEqual([
      "人員",
      "10/1 四",
      "10/2 五 · 公休",
      "場數",
    ]);
  });

  it("columnVisibility 裡有已不存在的欄位 id:忽略", () => {
    renderRoster({ columnVisibility: { removed: false } });

    expect(headerTexts()).toHaveLength(6);
  });
});

describe("RosterGrid 欄位群組收合成窄欄(受控)", () => {
  const groups = [
    { id: "stats", label: "統計", columnKeys: ["hours", "shifts"] },
  ];

  it("收合時那組換成一個窄欄 [統計 ▸];點了回報展開", async () => {
    const onChange = jest.fn();
    renderRoster({
      columnGroups: groups,
      collapsedColumnGroups: ["stats"],
      onCollapsedColumnGroupsChange: onChange,
    });

    expect(headerTexts()).not.toContain("時數");
    const toggle = screen.getByRole("button", { name: "統計" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("展開時那組照常顯示,第一欄表頭有 [統計 ▾];點了回報收合", async () => {
    const onChange = jest.fn();
    renderRoster({
      columnGroups: groups,
      collapsedColumnGroups: [],
      onCollapsedColumnGroupsChange: onChange,
    });

    expect(screen.getByText("時數")).toBeInTheDocument();
    expect(screen.getByText("場數")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "統計" }));
    expect(onChange).toHaveBeenCalledWith(["stats"]);
  });

  it("群組第一欄被隱藏時,收合鈕改放在下一個看得到的欄", () => {
    renderRoster({
      columnGroups: groups,
      collapsedColumnGroups: [],
      columnVisibility: { hours: false },
    });

    const toggle = screen.getByRole("button", { name: "統計" });
    expect(toggle.closest("th")?.textContent).toBe("場數");
  });

  it("群組第一欄被隱藏、群組收合時,窄欄照樣出現", () => {
    renderRoster({
      columnGroups: groups,
      collapsedColumnGroups: ["stats"],
      columnVisibility: { hours: false },
    });

    expect(screen.getByRole("button", { name: "統計" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(headerTexts()).not.toContain("場數");
  });
});

/** 頂部群組的預設內容(上午場一列,10/1 有標籤)。 */
const group = (patch: Partial<RosterTopGroup> = {}): RosterTopGroup => ({
  title: "時段需求",
  collapsed: false,
  onCollapsedChange: jest.fn(),
  emptyCellHint: "+ 時段需求",
  rows: [
    { key: "morning", label: "上午場", cells: { "2026-10-01": "負 1/1" } },
  ],
  summary: {
    "2026-10-01": { primary: "需 4 · 已排 3", secondary: "缺 1 · 可排 2" },
  },
  ...patch,
});

describe("RosterGrid 頂部固定群組", () => {
  it("展開:標題列 + 每一列;在表頭區塊裡,和表頭一起固定", () => {
    renderRoster({ topGroup: group() });

    const title = screen.getByRole("button", { name: "時段需求" });
    expect(title).toHaveAttribute("aria-expanded", "true");
    expect(title.closest("thead")).not.toBeNull();
    expect(screen.getByText("上午場").closest("thead")).not.toBeNull();
    expect(screen.getByText("負 1/1")).toBeInTheDocument();
    expect(screen.queryByText("需 4 · 已排 3")).toBeNull();
  });

  it("收合狀態由使用處控制:點標題只回報,收合時顯示每日彙總(主行 + 副行)", async () => {
    const onCollapsedChange = jest.fn();
    const { rerender } = renderRoster({
      topGroup: group({ onCollapsedChange }),
    });

    await userEvent.click(screen.getByRole("button", { name: "時段需求" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    // 外部沒改 collapsed 之前,畫面不變
    expect(screen.getByText("上午場")).toBeInTheDocument();

    rerender(
      <RosterGrid
        people={demoStaff(3)}
        getPersonKey={(person) => person.id}
        dates={demoDates(3, [2])}
        leadingColumns={[personColumn]}
        renderCell={() => null}
        topGroup={group({ collapsed: true, onCollapsedChange })}
      />,
    );
    expect(screen.queryByText("上午場")).toBeNull();
    const summary = screen.getByText("需 4 · 已排 3");
    expect(summary.closest("thead")).not.toBeNull();
    expect(screen.getByText("缺 1 · 可排 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "時段需求" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("空白格點了回呼模組(帶日期與那一列);停用日沒有空白格", async () => {
    const onEmptyCellClick = jest.fn();
    renderRoster({ topGroup: group({ onEmptyCellClick }) });

    const empty = screen.getByRole("button", { name: "+ 時段需求 2026-10-03" });
    expect(within(empty).getByText("+ 時段需求")).toBeInTheDocument();
    await userEvent.click(empty);
    expect(onEmptyCellClick).toHaveBeenCalledWith("2026-10-03", "morning");
    expect(
      screen.queryByRole("button", { name: "+ 時段需求 2026-10-02" }),
    ).toBeNull();
  });
});
