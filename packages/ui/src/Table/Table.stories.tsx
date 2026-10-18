import type { Meta, StoryObj } from "@storybook/react-vite";

import { Table, type TableColumn } from "./Table";

interface DemoUser {
  id: string;
  name: string;
  account: string;
  org: string;
}

const columns: TableColumn<DemoUser>[] = [
  {
    key: "name",
    header: "姓名",
    render: (row) => row.name,
    isEmphasized: true,
  },
  { key: "account", header: "帳號", render: (row) => row.account },
  { key: "org", header: "所屬組織", render: (row) => row.org },
];

const rows: DemoUser[] = [
  { id: "u1", name: "王小明", account: "ming", org: "台北分店" },
  { id: "u2", name: "陳小華", account: "hua", org: "高雄分店" },
  { id: "u3", name: "林大同", account: "tong", org: "總部" },
];

const meta = {
  title: "Components/Table",
  component: Table,
  args: {
    columns,
    rows,
    getRowKey: (row: DemoUser) => row.id,
    "aria-label": "使用者清單",
  },
} satisfies Meta<typeof Table<DemoUser>>;

export default meta;
// 泛型元件:Story 直接綁在實例化過的 Table<DemoUser> 上,args 才保有 DemoUser 型別
type Story = StoryObj<typeof Table<DemoUser>>;

export const Default: Story = {};
export const Compact: Story = { args: { size: "small" } };
export const Clickable: Story = {
  args: {
    onRowClick: (row: DemoUser) => {
      globalThis.console.log("row clicked", row.id);
    },
  },
};
export const Empty: Story = { args: { rows: [] } };
export const EmptyWithCustomMessage: Story = {
  args: { rows: [], emptyMessage: "找不到符合條件的使用者" },
};
export const Loading: Story = { args: { isLoading: true } };

/**
 * 少列 + 窄寬:容器撐滿外框高度,橫向捲軸落在框底而不是最後一列下方。
 * 外框模擬頁面上的卡片區(STYLE-08 的 `flex: 1; minHeight: 0` 欄)。
 */
export const FewRowsInNarrowPanel: Story = {
  args: { rows: rows.slice(0, 1), minWidth: 720 },
  decorators: [
    (Story) => (
      <div
        style={{
          width: 420,
          height: 320,
          display: "flex",
          flexDirection: "column",
          border: "1px dashed #c4cdd5",
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <Story />
        </div>
      </div>
    ),
  ],
};
