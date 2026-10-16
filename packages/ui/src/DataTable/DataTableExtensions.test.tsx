import { describe, expect, it } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";

import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { setupFakeViewport } from "../test/viewport";
import { DataTable, type DataTableColumn } from "./DataTable";

/** `DataTable` 為班表(RosterGrid)打開的三個能力:欄位顯示 / 隱藏、表頭下方的固定列、欄位樣式。 */

interface Item {
  id: string;
  name: string;
  qty: number;
}

const rows: Item[] = [
  { id: "a", name: "蘿蔔", qty: 3 },
  { id: "b", name: "高麗菜", qty: 5 },
];
const columns: DataTableColumn<Item>[] = [
  { key: "name", header: "品名", accessor: "name", pinned: "left" },
  { key: "qty", header: "數量", accessor: "qty" },
  { key: "note", header: "備註" },
];
const getRowKey = (row: Item) => row.id;
const headerTexts = () =>
  screen.getAllByRole("columnheader").map((cell) => cell.textContent);

setupFakeViewport();

describe("DataTable 欄位顯示 / 隱藏", () => {
  it("受控 columnVisibility:false 的欄不畫表頭與格子,改回 true 又出現", () => {
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        columnVisibility={{ qty: false }}
      />,
    );

    expect(headerTexts()).toEqual(["品名", "備註"]);
    expect(screen.queryByText("3")).toBeNull();

    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        columnVisibility={{ qty: true }}
      />,
    );
    expect(headerTexts()).toEqual(["品名", "數量", "備註"]);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("狀態裡有已不存在的欄位 key:忽略,畫面照常", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        columnVisibility={{ removed: false, qty: true }}
      />,
    );

    expect(headerTexts()).toEqual(["品名", "數量", "備註"]);
  });
});

describe("DataTable 固定列 topRows", () => {
  it("畫在表頭之後、資料列之前,依欄位對齊;aria-rowindex 接著表頭數", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        aria-label="品項"
        topRows={[
          {
            key: "total",
            renderCell: (key) => (key === "name" ? "合計" : null),
          },
        ]}
      />,
    );

    const table = screen.getByRole("table", { name: "品項" });
    const tableRows = within(table).getAllByRole("row");
    expect(tableRows[1]?.textContent).toBe("合計");
    expect(tableRows[1]?.getAttribute("aria-rowindex")).toBe("2");
    expect(tableRows[1]?.closest("thead")).not.toBeNull();
    expect(
      screen.getByText("蘿蔔").closest("tr")?.getAttribute("aria-rowindex"),
    ).toBe("3");
    expect(table.getAttribute("aria-rowcount")).toBe("4");
  });

  it("有固定列時整個表頭一起 sticky;固定欄的格子照樣貼左", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        topRows={[{ key: "x", renderCell: (key) => `固定-${key}` }]}
      />,
    );

    const thead = container.querySelector("thead");
    if (thead === null) throw new Error("沒有 thead");
    const theadRules = cssRulesMatching(`.${emotionClassOf(thead)}`);
    expect(declaredValue(theadRules, "position")).toBe("sticky");
    expect(declaredValue(theadRules, "top")).toBe("0");
    // 分開框線:格線畫在格子自己的不透明底上,捲過去的資料列不會從格線透出來
    const tableElement = container.querySelector("table");
    if (tableElement === null) throw new Error("沒有 table");
    expect(
      declaredValue(
        cssRulesMatching(`.${emotionClassOf(tableElement)}`),
        "border-collapse",
      ),
    ).toBe("separate");

    const pinnedTop = screen.getByText("固定-name").closest("td");
    if (pinnedTop === null) throw new Error("固定列的格子不是 td");
    const rules = cssRulesMatching(`.${emotionClassOf(pinnedTop)}`);
    expect(declaredValue(rules, "position")).toBe("sticky");
    expect(declaredValue(rules, "left")).toBe("0");
  });

  it("沒有固定列時表頭維持逐格 sticky(既有行為)", () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} getRowKey={getRowKey} />,
    );

    expect(
      container
        .querySelector("table")
        ?.classList.contains("MuiTable-stickyHeader"),
    ).toBe(true);
  });
});

describe("DataTable 欄位樣式", () => {
  it("cellSx 疊在表身格上、headerSx 疊在表頭格上", () => {
    render(
      <DataTable
        columns={[
          {
            key: "name",
            header: "品名",
            accessor: "name",
            cellSx: { whiteSpace: "normal" },
            headerSx: { textAlign: "center" },
          },
        ]}
        rows={rows}
        getRowKey={getRowKey}
      />,
    );

    const cell = screen.getByText("蘿蔔").closest("td");
    const header = screen.getByRole("columnheader", { name: /品名/ });
    if (cell === null) throw new Error("不是 td");
    expect(
      declaredValue(
        cssRulesMatching(`.${emotionClassOf(cell)}`),
        "white-space",
      ),
    ).toBe("normal");
    expect(
      declaredValue(
        cssRulesMatching(`.${emotionClassOf(header)}`),
        "text-align",
      ),
    ).toBe("center");
  });
});
