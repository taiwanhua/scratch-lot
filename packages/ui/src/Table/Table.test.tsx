import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import type { CellRenderContext } from "../DataTable/cell-render-context";
import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { Table, type TableColumn } from "./Table";

interface DemoRow {
  id: string;
  name: string;
  account: string;
}

const columns: TableColumn<DemoRow>[] = [
  {
    key: "name",
    header: "姓名",
    render: (row) => row.name,
    isEmphasized: true,
  },
  { key: "account", header: "帳號", render: (row) => row.account },
];

const rows: DemoRow[] = [
  { id: "u1", name: "王小明", account: "ming" },
  { id: "u2", name: "陳小華", account: "hua" },
];

const getRowKey = (row: DemoRow) => row.id;

/** 捲動容器(`TableContainer`)身上 emotion 實際產生的規則(TEST-09)。 */
const containerRulesOf = (container: HTMLElement): CSSStyleRule[] => {
  const scroller = container.querySelector(".MuiTableContainer-root");
  if (scroller === null) {
    throw new Error("找不到表格的捲動容器");
  }
  return cssRulesMatching(`.${emotionClassOf(scroller)}`);
};

describe("Table", () => {
  it("有資料時渲染表頭與每一列", () => {
    render(<Table columns={columns} rows={rows} getRowKey={getRowKey} />);

    expect(screen.getByText("姓名")).not.toBeNull();
    expect(screen.getByText("帳號")).not.toBeNull();
    expect(screen.getByText("王小明")).not.toBeNull();
    expect(screen.getByText("陳小華")).not.toBeNull();
  });

  it("render 的選填第二參數帶與 DataTable 同形的 ctx(REACT-13)", () => {
    const seen: CellRenderContext<DemoRow>[] = [];
    const accountColumn: TableColumn<DemoRow> = {
      key: "account",
      header: "帳號",
      accessor: "account",
      render: (row, ctx) => {
        seen.push(ctx);
        return row.account;
      },
    };
    render(
      <Table columns={[accountColumn]} rows={rows} getRowKey={getRowKey} />,
    );

    expect(seen[1]).toEqual({
      value: "hua",
      row: rows[1],
      rows,
      index: 1,
      column: accountColumn,
    });
  });

  it("沒有資料時顯示空狀態文案", () => {
    render(<Table columns={columns} rows={[]} getRowKey={getRowKey} />);

    expect(screen.getByText("目前沒有資料")).not.toBeNull();
  });

  it("空狀態文案可由呼叫端指定", () => {
    render(
      <Table
        columns={columns}
        rows={[]}
        getRowKey={getRowKey}
        emptyMessage="找不到符合條件的使用者"
      />,
    );

    expect(screen.getByText("找不到符合條件的使用者")).not.toBeNull();
  });

  it("載入中時顯示載入指示,且不渲染任何資料列", () => {
    render(
      <Table columns={columns} rows={rows} getRowKey={getRowKey} isLoading />,
    );

    expect(screen.getByLabelText("載入中")).not.toBeNull();
    expect(screen.queryByText("王小明")).toBeNull();
  });

  it("載入中時不顯示空狀態文案", () => {
    render(
      <Table columns={columns} rows={[]} getRowKey={getRowKey} isLoading />,
    );

    expect(screen.queryByText("目前沒有資料")).toBeNull();
  });

  /** 容器比 `minWidth` 窄時要橫向捲,而不是把欄位擠成折行。 */
  it("minWidth 給到表格上,未給時不設限", () => {
    const { container: withMin } = render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        minWidth={832}
      />,
    );
    expect(
      globalThis.getComputedStyle(withMin.querySelector("table") as HTMLElement)
        .minWidth,
    ).toBe("832px");

    const { container: withoutMin } = render(
      <Table columns={columns} rows={rows} getRowKey={getRowKey} />,
    );
    expect(
      globalThis.getComputedStyle(
        withoutMin.querySelector("table") as HTMLElement,
      ).minWidth,
    ).toBe("");
  });

  /** 容器撐滿父層高度,列數少時橫向捲軸才落在面板底部而不是最後一列下方。 */
  it("捲動容器預設撐滿父層高度", () => {
    const { container } = render(
      <Table columns={columns} rows={rows} getRowKey={getRowKey} />,
    );
    const rules = containerRulesOf(container);

    expect(declaredValue(rules, "height")).toBe("100%");
    expect(declaredValue(rules, "min-height")).toBe("0");
  });

  it("containerSx 疊在預設之上,呼叫端可改寫容器高度", () => {
    const { container } = render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={getRowKey}
        containerSx={{ height: "auto", maxHeight: 240 }}
      />,
    );
    const rules = containerRulesOf(container);

    // 後寫的蓋前面的:呼叫端的 height 贏,沒覆寫的 min-height 仍是預設值
    expect(declaredValue(rules, "height")).toBe("auto");
    expect(declaredValue(rules, "max-height")).toBe("240px");
    expect(declaredValue(rules, "min-height")).toBe("0");
  });
});
