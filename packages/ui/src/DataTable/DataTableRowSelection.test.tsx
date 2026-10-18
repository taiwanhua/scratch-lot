import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { setupFakeViewport } from "../test/viewport";
import { DataTable, type DataTableColumn } from "./DataTable";

/** `DataTable` 的選用列勾選:預設關閉;以列 key 記選取、換頁保留、上限、清除。 */

interface Item {
  id: string;
  name: string;
  isLocked?: boolean;
}

const pageOne: Item[] = [
  { id: "a", name: "甲" },
  { id: "b", name: "乙" },
  { id: "c", name: "丙", isLocked: true },
];
const pageTwo: Item[] = [
  { id: "d", name: "丁" },
  { id: "e", name: "戊" },
];
const columns: DataTableColumn<Item>[] = [
  { key: "name", header: "名稱", accessor: "name" },
];
const getRowKey = (row: Item) => row.id;

interface HarnessProps {
  rows: readonly Item[];
  initial?: string[];
  maxCount?: number;
  onRowClick?: (row: Item) => void;
}

/** 呼叫端持有選取(換頁時 rows 換掉、選取不動)。 */
const Harness = ({
  rows,
  initial = [],
  maxCount,
  onRowClick,
}: HarnessProps) => {
  const [keys, setKeys] = useState<string[]>(initial);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={getRowKey}
      onRowClick={onRowClick}
      rowSelection={{
        selectedKeys: keys,
        onSelectedKeysChange: setKeys,
        maxCount,
        isRowSelectable: (row) => row.isLocked !== true,
        hint: "只能批次核准",
        actions: <button type="button">核准({keys.length})</button>,
        labels: { selectRow: (row) => `勾選 ${row.name}` },
      }}
    />
  );
};

const rowBox = (name: string) =>
  screen.getByRole("checkbox", { name: `勾選 ${name}` });

setupFakeViewport();

describe("DataTable 列勾選", () => {
  it("沒開列勾選:不畫勾選框,也沒有「已選」列(既有表格不變)", () => {
    render(
      <DataTable columns={columns} rows={pageOne} getRowKey={getRowKey} />,
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText(/已選/)).toBeNull();
  });

  it("勾一列 → 上方出現「已選 1 筆」、說明與動作;按「清除」全部取消、列消失", async () => {
    const user = userEvent.setup();
    render(<Harness rows={pageOne} />);
    expect(screen.queryByText(/已選/)).toBeNull();

    await user.click(rowBox("甲"));
    expect(screen.getByText("已選 1 筆")).toBeInTheDocument();
    expect(screen.getByText("只能批次核准")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核准(1)" })).toBeInTheDocument();
    expect(rowBox("甲")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.queryByText(/已選/)).toBeNull();
    expect(rowBox("甲")).not.toBeChecked();
  });

  it("換頁:別頁勾的保留,「已選 N 筆」照算;回到原頁仍是勾著的", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness rows={pageOne} />);
    await user.click(rowBox("甲"));
    await user.click(rowBox("乙"));

    rerender(<Harness rows={pageTwo} />);
    await user.click(rowBox("丁"));
    expect(screen.getByText("已選 3 筆")).toBeInTheDocument();

    rerender(<Harness rows={pageOne} />);
    expect(rowBox("甲")).toBeChecked();
    expect(rowBox("乙")).toBeChecked();
  });

  it("不可勾的列停用;到上限時其他未勾的列停用,已勾的仍可取消", async () => {
    const user = userEvent.setup();
    render(<Harness rows={[...pageOne, ...pageTwo]} maxCount={2} />);
    expect(rowBox("丙")).toBeDisabled();

    await user.click(rowBox("甲"));
    await user.click(rowBox("乙"));
    expect(rowBox("丁")).toBeDisabled();
    expect(rowBox("戊")).toBeDisabled();
    expect(rowBox("甲")).toBeEnabled();

    await user.click(rowBox("甲"));
    expect(rowBox("丁")).toBeEnabled();
  });

  it("表頭「全選本頁」:勾本頁可勾的列(不超過上限);再按一次取消本頁,別頁的不動", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness rows={pageTwo} initial={[]} />);
    await user.click(rowBox("丁"));
    rerender(<Harness rows={pageOne} />);

    const selectPage = screen.getByRole("checkbox", { name: "全選本頁" });
    await user.click(selectPage);
    expect(rowBox("甲")).toBeChecked();
    expect(rowBox("乙")).toBeChecked();
    expect(rowBox("丙")).not.toBeChecked();
    expect(screen.getByText("已選 3 筆")).toBeInTheDocument();

    await user.click(selectPage);
    expect(rowBox("甲")).not.toBeChecked();
    expect(screen.getByText("已選 1 筆")).toBeInTheDocument();
  });

  it("全選本頁遇到上限只勾到上限", async () => {
    const user = userEvent.setup();
    render(<Harness rows={[...pageOne, ...pageTwo]} maxCount={3} />);
    await user.click(screen.getByRole("checkbox", { name: "全選本頁" }));
    expect(screen.getByText("已選 3 筆")).toBeInTheDocument();
    expect(rowBox("戊")).toBeDisabled();
  });

  it("已到上限、本頁只勾了一部分:表頭勾選框按下去 = 取消本頁(別頁勾的不動);本頁一列都沒勾時停用", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness rows={pageTwo} maxCount={2} />);
    await user.click(rowBox("丁"));
    rerender(<Harness rows={pageOne} maxCount={2} />);
    await user.click(rowBox("甲"));
    expect(rowBox("乙")).toBeDisabled();

    const selectPage = screen.getByRole("checkbox", { name: "全選本頁" });
    expect(selectPage).toHaveAttribute("data-indeterminate", "true");
    await user.click(selectPage);
    expect(rowBox("甲")).not.toBeChecked();
    expect(screen.getByText("已選 1 筆")).toBeInTheDocument();

    // 回到別頁補滿上限;本頁一列都沒勾 → 表頭停用
    rerender(<Harness rows={pageTwo} maxCount={2} />);
    await user.click(rowBox("戊"));
    rerender(<Harness rows={pageOne} maxCount={2} />);
    expect(screen.getByRole("checkbox", { name: "全選本頁" })).toBeDisabled();
  });

  it("點勾選框不觸發整列點擊", async () => {
    const user = userEvent.setup();
    const onRowClick = jest.fn();
    render(<Harness rows={pageOne} onRowClick={onRowClick} />);
    await user.click(rowBox("甲"));
    expect(onRowClick).not.toHaveBeenCalled();
    await user.click(screen.getByText("乙"));
    expect(onRowClick).toHaveBeenCalledWith(pageOne[1]);
  });
});
