import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Tag } from "../Tag/Tag";
import { Typography } from "../Typography/Typography";
import {
  DataTable,
  type DataTableColumn,
  type DataTableColumnWidths,
  type DataTableProps,
  type DataTableSort,
} from "./DataTable";

interface DemoOrder {
  id: string;
  customer: string;
  store: string;
  dish: string;
  amount: number;
  status: "待付款" | "已完成" | "已取消";
  createdAt: string;
}

const customers = ["王小明", "陳小華", "林大同", "張美玲", "李志強", "黃雅婷"];
const stores = ["台北分店", "高雄分店", "台中分店", "總部"];
const dishes = ["滷肉飯", "牛肉麵", "蚵仔煎", "鹹酥雞", "珍珠奶茶", "小籠包"];
const statuses: DemoOrder["status"][] = ["待付款", "已完成", "已取消"];

const makeOrders = (count: number): DemoOrder[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `o${String(index + 1)}`,
    customer: customers[index % customers.length] ?? "",
    store: stores[index % stores.length] ?? "",
    dish: dishes[(index * 7) % dishes.length] ?? "",
    amount: 60 + ((index * 37) % 540),
    status: statuses[index % statuses.length] ?? "待付款",
    createdAt: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
  }));

const fewOrders = makeOrders(12);
const manyOrders = makeOrders(10_000);

const statusTone = {
  待付款: "warning",
  已完成: "success",
  已取消: "grey",
} as const;

const amountColumn: DataTableColumn<DemoOrder> = {
  key: "amount",
  header: "金額",
  accessor: "amount",
  width: 120,
  align: "right",
  isSortable: true,
  render: ({ value }) => `NT$ ${String(value)}`,
};

const columns: DataTableColumn<DemoOrder>[] = [
  {
    key: "id",
    header: "訂單編號",
    accessor: "id",
    width: 120,
    isEmphasized: true,
  },
  { key: "customer", header: "顧客", accessor: "customer", width: 120 },
  { key: "store", header: "門市", accessor: "store", width: 140 },
  { key: "dish", header: "品項", accessor: "dish", width: 140 },
  amountColumn,
  {
    key: "status",
    header: "狀態",
    accessor: "status",
    width: 120,
    render: ({ row }) => (
      <Tag tone={statusTone[row.status]} label={row.status} />
    ),
  },
  { key: "createdAt", header: "建立日期", accessor: "createdAt", width: 140 },
];

const sortableColumns = columns.map((column) =>
  column.key === "status" ? column : { ...column, isSortable: true },
);

const pinnedColumns = columns.map((column): DataTableColumn<DemoOrder> => {
  if (column.key === "id") {
    return { ...column, pinned: "left" };
  }
  if (column.key === "status") {
    return { ...column, pinned: "right" };
  }
  return column;
});

type DemoProps = DataTableProps<DemoOrder>;

/** 欄寬受控的示範:呼叫端持有 `columnWidths`。 */
const ControlledWidthsDemo = (props: DemoProps) => {
  const [widths, setWidths] = useState<DataTableColumnWidths>({});
  return (
    <>
      <DataTable
        {...props}
        columnWidths={widths}
        onColumnWidthsChange={setWidths}
        containerSx={{ height: "auto", maxHeight: 400 }}
      />
      <Typography variant="caption" color="text.secondary">
        columnWidths = {JSON.stringify(widths)}
      </Typography>
    </>
  );
};

/** 排序受控的示範:呼叫端持有 `sort`。 */
const ControlledSortDemo = (props: DemoProps) => {
  const [sort, setSort] = useState<DataTableSort | null>({
    key: "amount",
    direction: "desc",
  });
  return (
    <>
      <DataTable
        {...props}
        sort={sort}
        onSortChange={setSort}
        containerSx={{ height: "auto", maxHeight: 400 }}
      />
      <Typography variant="caption" color="text.secondary">
        sort = {JSON.stringify(sort)}
      </Typography>
    </>
  );
};

/** 虛擬捲動需要確定的高度:外框模擬頁面上 `flex: 1; minHeight: 0` 的面板(STYLE-08)。 */
const panelDecorator: Decorator = (Story) => (
  <div style={{ height: 480, display: "flex", flexDirection: "column" }}>
    <div style={{ flex: 1, minHeight: 0 }}>
      <Story />
    </div>
  </div>
);

const meta = {
  title: "Components/DataTable",
  component: DataTable,
  args: {
    columns,
    rows: fewOrders,
    getRowKey: (row: DemoOrder) => row.id,
    "aria-label": "訂單清單",
  },
  decorators: [panelDecorator],
} satisfies Meta<typeof DataTable<DemoOrder>>;

export default meta;
// 泛型元件:Story 綁在實例化過的 DataTable<DemoOrder> 上,args 才保有 DemoOrder 型別
type Story = StoryObj<typeof DataTable<DemoOrder>>;

/** 基本表:12 列、沒有排序與固定欄;每欄右緣都可拖拉調寬。 */
export const Default: Story = {};

/** 一萬列:只渲染可視範圍附近的列,捲動不掉幀;表頭固定在上方。 */
export const TenThousandRows: Story = {
  args: { rows: manyOrders, columns: sortableColumns },
};

/** 欄寬受控:拖拉表頭右緣(或聚焦把手後按左右鍵),下方即時顯示呼叫端拿到的欄寬。 */
export const ResizableColumns: Story = {
  render: (args) => <ControlledWidthsDemo {...args} />,
};

/** 左固定「訂單編號」、右固定「狀態」;外框窄於欄寬總和,橫向捲動時兩欄不動,交界有陰影。 */
export const PinnedColumns: Story = {
  args: { columns: pinnedColumns, rows: manyOrders },
  decorators: [
    (Story) => (
      <div style={{ width: 640, height: "100%" }}>
        <Story />
      </div>
    ),
  ],
};

/** 排序受控:點表頭依「升冪 → 降冪 → 不排序」輪替,下方顯示目前排序。 */
export const Sortable: Story = {
  args: { columns: sortableColumns },
  render: (args) => <ControlledSortDemo {...args} />,
};

export const Loading: Story = { args: { isLoading: true } };
export const Empty: Story = { args: { rows: [] } };

/** `render(ctx)` 用 `rows` / `index` 算累計金額與佔比(合計列的做法);排序後照顯示順序重算。 */
export const RunningTotal: Story = {
  args: {
    columns: [
      ...sortableColumns.slice(0, 2),
      amountColumn,
      {
        key: "runningTotal",
        header: "累計金額",
        width: 140,
        align: "right",
        render: ({ rows, index }) =>
          `NT$ ${String(
            rows
              .slice(0, index + 1)
              .reduce((sum, order) => sum + order.amount, 0),
          )}`,
      },
      {
        key: "share",
        header: "佔全部",
        width: 100,
        align: "right",
        render: ({ row, rows }) => {
          const total = rows.reduce((sum, order) => sum + order.amount, 0);
          return `${((row.amount / total) * 100).toFixed(1)}%`;
        },
      },
    ],
  },
};

/** `render(ctx)` 用 `index` 做奇偶列:序號欄依奇偶換色。 */
export const ZebraByIndex: Story = {
  args: {
    columns: [
      {
        key: "no",
        header: "序號",
        width: 100,
        render: ({ index }) => (
          <Tag tone={index % 2 === 0 ? "primary" : "grey"} label={index + 1} />
        ),
      },
      ...columns.slice(1),
    ],
  },
};

export const Small: Story = {
  args: { size: "small", rows: manyOrders, columns: pinnedColumns },
};

export const Clickable: Story = {
  args: {
    onRowClick: (row: DemoOrder) => {
      globalThis.console.log("row clicked", row.id);
    },
  },
};

const RowSelectionDemo = (args: DataTableProps<DemoOrder>) => {
  const [keys, setKeys] = useState<string[]>([]);
  return (
    <DataTable
      {...args}
      rowSelection={{
        selectedKeys: keys,
        onSelectedKeysChange: setKeys,
        maxCount: 5,
        isRowSelectable: (row) => row.status === "待付款",
        hint: "只有待付款的能勾,最多 5 筆",
      }}
    />
  );
};

/** 列勾選(選用):只有待付款的能勾、上限 5 筆(到上限時其他未勾的列停用);上方「已選 N 筆 · 清除」。 */
export const RowSelection: Story = {
  args: { rows: makeOrders(40) },
  render: (args) => <RowSelectionDemo {...args} />,
};
