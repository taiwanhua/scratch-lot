import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Box } from "../Box/Box";
import { Checkbox } from "../Checkbox/Checkbox";
import type {
  DataTableColumn,
  DataTableColumnVisibility,
} from "../DataTable/data-table-column";
import { FormControlLabel } from "../FormControlLabel/FormControlLabel";
import { Tag } from "../Tag/Tag";
import { Typography } from "../Typography/Typography";
import { RosterGrid, type RosterGridProps } from "./RosterGrid";
import {
  type DemoStaff,
  demoDates,
  demoStaff,
  hasDemoShift,
} from "./roster-grid-story-data";
import type { RosterCellKey, RosterTopGroup } from "./roster-grid-types";

const personColumn: DataTableColumn<DemoStaff> = {
  key: "person",
  header: "人員",
  width: 176,
  render: ({ row }) => (
    <Box>
      <Typography variant="subtitle2">{row.name}</Typography>
      <Typography variant="caption" color="text.secondary">
        {row.role}
      </Typography>
    </Box>
  ),
};

const statColumns: DataTableColumn<DemoStaff>[] = [
  {
    key: "hours",
    header: "時數",
    accessor: "hours",
    width: 80,
    align: "right",
  },
  {
    key: "shifts",
    header: "班數",
    accessor: "shifts",
    width: 80,
    align: "right",
  },
];

/** 班別標籤(格子內容由使用的模組決定;這裡用 Tag 示範)。 */
const renderShift: RosterGridProps<DemoStaff>["renderCell"] = ({
  date,
  index,
}) =>
  hasDemoShift(index, Number(date.slice(-2))) ? (
    <Tag tone="primary" label="09:00–17:00 櫃台 A" />
  ) : null;

const staffingGroup = (
  collapsed: boolean,
  onCollapsedChange: (collapsed: boolean) => void,
  onEmptyCellClick: (date: string, rowKey: string) => void,
): RosterTopGroup => ({
  title: "人力需求",
  collapsed,
  onCollapsedChange,
  emptyCellHint: "+ 人力需求",
  onEmptyCellClick,
  rows: [
    {
      key: "morning",
      label: "早班",
      cells: {
        "2026-10-01": <Tag label="負 1/1 協 1/1" />,
        "2026-10-02": <Tag tone="warning" label="負 1/1 協 0/1" />,
        "2026-10-05": <Tag tone="error" label="負 0/1 協 1/1" />,
      },
    },
    {
      key: "evening",
      label: "晚班",
      cells: { "2026-10-01": <Tag label="負 1/1 協 1/1" /> },
    },
  ],
  summary: {
    "2026-10-01": { primary: "需 4 · 已排 4" },
    "2026-10-02": {
      primary: "需 4 · 已排 3",
      secondary: "缺 1 · 可排 2",
      tone: "warning",
    },
    "2026-10-05": {
      primary: "需 4 · 已排 3",
      secondary: "缺 1 · 可排 0",
      tone: "error",
    },
  },
});

interface DemoOptions {
  withTopGroup?: boolean;
  initialTopGroupCollapsed?: boolean;
  initialCollapsedStats?: boolean;
  showColumnSettings?: boolean;
}

/** [⚙ 顯示欄位] 列出的欄位(文字由使用的模組提供) */
const toggleable = [
  { key: "person", label: "人員" },
  { key: "hours", label: "時數" },
  { key: "shifts", label: "班數" },
] as const;

/** 扮演使用的模組:持有選取、欄位顯示、統計欄收合、頂部群組收合。 */
const ControlledRoster = ({
  withTopGroup = false,
  initialTopGroupCollapsed = false,
  initialCollapsedStats = false,
  showColumnSettings = false,
  ...props
}: RosterGridProps<DemoStaff> & DemoOptions) => {
  const [selected, setSelected] = useState<RosterCellKey | null>(null);
  const [visibility, setVisibility] = useState<DataTableColumnVisibility>({});
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(
    initialCollapsedStats ? ["stats"] : [],
  );
  const [topCollapsed, setTopCollapsed] = useState(initialTopGroupCollapsed);
  const [lastAction, setLastAction] = useState("");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {showColumnSettings ? (
        <Box sx={{ display: "flex", gap: 2 }}>
          {/* [⚙ 顯示欄位] 由使用的模組提供;這裡用勾選框示範 */}
          {toggleable.map((column) => (
            <FormControlLabel
              key={column.key}
              label={column.label}
              control={
                <Checkbox
                  checked={visibility[column.key] !== false}
                  onChange={(_, checked) => {
                    setVisibility({ ...visibility, [column.key]: checked });
                  }}
                />
              }
            />
          ))}
        </Box>
      ) : null}
      <RosterGrid
        {...props}
        selectedCell={selected}
        onCellClick={(person, date) => {
          setSelected({ personKey: person.id, date });
        }}
        columnVisibility={visibility}
        onColumnVisibilityChange={setVisibility}
        columnGroups={[
          { id: "stats", label: "統計", columnKeys: ["hours", "shifts"] },
        ]}
        collapsedColumnGroups={collapsedGroups}
        onCollapsedColumnGroupsChange={setCollapsedGroups}
        topGroup={
          withTopGroup
            ? staffingGroup(topCollapsed, setTopCollapsed, (date, rowKey) => {
                setLastAction(`新增人力需求:${date} / ${rowKey}`);
              })
            : undefined
        }
      />
      <Typography variant="caption" color="text.secondary">
        selected = {JSON.stringify(selected)} {lastAction}
      </Typography>
    </Box>
  );
};

/**
 * 班表(人 × 日期):左固定人員欄、右固定統計欄,中間日期區左右捲動;列虛擬捲動。
 * 欄位顯示、統計欄收合、頂部群組收合都是受控值:示範用 `useState` 扮演使用的模組
 * (正式使用時模組存在瀏覽器,key 照 `createAdminStorageKeys`)。
 */
const meta = {
  title: "Components/RosterGrid",
  component: RosterGrid<DemoStaff>,
  parameters: { layout: "padded" },
  args: {
    people: demoStaff(8),
    getPersonKey: (person: DemoStaff) => person.id,
    dates: demoDates(14),
    leadingColumns: [personColumn],
    trailingColumns: statColumns,
    renderCell: renderShift,
    formatCellLabel: (person: DemoStaff, date: string) =>
      `${person.name} ${date}`,
    containerSx: { height: 520 },
    "aria-label": "班表",
  },
  render: (args) => <ControlledRoster {...args} />,
} satisfies Meta<typeof RosterGrid<DemoStaff>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 沒有頂部群組(Figma Group=None 49:494);點格子選取,每週二店休整欄停用。 */
export const Default: Story = {};

/** 頂部群組展開(Figma Group=Expanded 366:7737):空白格滑過顯示「+ 人力需求」,點了回呼模組。 */
export const TopGroupExpanded: Story = {
  render: (args) => <ControlledRoster {...args} withTopGroup />,
};

/** 頂部群組收合(Figma Group=Collapsed 366:7806):一列彙總,主行 + 副行。 */
export const TopGroupCollapsed: Story = {
  render: (args) => (
    <ControlledRoster {...args} withTopGroup initialTopGroupCollapsed />
  ),
};

/** 欄位顯示 / 隱藏:模組提供 [⚙ 顯示欄位],元件只回報。 */
export const ColumnVisibility: Story = {
  render: (args) => <ControlledRoster {...args} showColumnSettings />,
};

/** 統計欄收合成一個窄欄 [統計 ▸],點了展開。 */
export const CollapsedColumnGroup: Story = {
  render: (args) => <ControlledRoster {...args} initialCollapsedStats />,
};

/** 1000 人 × 31 天:列虛擬捲動,只畫可視範圍附近的列。 */
export const ThousandPeople: Story = {
  args: { people: demoStaff(1000), dates: demoDates(31) },
  render: (args) => <ControlledRoster {...args} withTopGroup />,
};

/** 暗色模式:顏色只用主題 token。 */
export const DarkMode: Story = {
  render: (args) => <ControlledRoster {...args} withTopGroup />,
  globals: { mode: "dark" },
};
