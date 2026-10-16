import type { Theme } from "@mui/material/styles";
import type { RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { Box } from "../Box/Box";
import type { DataTableColumn } from "../DataTable/data-table-column";
import { RosterGroupToggle } from "./RosterGroupToggle";
import type {
  RosterCellContext,
  RosterColumnGroup,
  RosterDate,
} from "./roster-grid-types";

/** 收合後那一個窄欄的 key 前綴(不會和日期 `YYYY-MM-DD` 或模組的欄位 key 撞名)。 */
export const COLLAPSED_GROUP_KEY_PREFIX = "roster-group:";

/** 日期欄預設寬度(Figma Draft/RosterGrid 366:7960 的日期欄 128) */
export const DEFAULT_DATE_COLUMN_WIDTH = 128;
/**
 * 停用日(店休)整欄的停用色:`action.disabledBackground` 是半透明,當成圖層疊在原底色上,
 * 格子仍是不透明的 —— 表頭與頂部群組固定在上方時,捲過去的人員列才不會透出來。
 */
const disabledLayerSx = {
  backgroundImage: (theme: Theme) => {
    const color = (theme.vars ?? theme).palette.action.disabledBackground;
    return `linear-gradient(${color}, ${color})`;
  },
};

/** 收合窄欄的寬度 */
const COLLAPSED_GROUP_WIDTH = 88;

export interface UseRosterColumnsOptions<Person> {
  leadingColumns: readonly DataTableColumn<Person>[];
  trailingColumns: readonly DataTableColumn<Person>[];
  dates: readonly RosterDate[];
  dateColumnWidth: number;
  renderDateCell: (ctx: RosterCellContext<Person>) => ReactNode;
  columnGroups: readonly RosterColumnGroup[];
  collapsedColumnGroups: readonly string[];
  onToggleGroup: (groupId: string) => void;
}

/** 欄位群組展開時,收合鈕(只有 ▾,名稱是群組名)疊在該組第一欄的表頭前面,不多佔欄寬。 */
const withExpandedToggle = <Person,>(
  column: DataTableColumn<Person>,
  group: RosterColumnGroup,
  onToggle: () => void,
): DataTableColumn<Person> => ({
  ...column,
  header: (
    <Box component="span" sx={{ display: "inline-flex", gap: 0.5 }}>
      <RosterGroupToggle
        label={group.label}
        hideLabel
        expanded
        onToggle={onToggle}
      />
      {column.header}
    </Box>
  ),
});

/** 一組欄位收合成的窄欄:表頭是 [label ▸],格子空白。 */
const collapsedGroupColumn = <Person,>(
  group: RosterColumnGroup,
  pinned: DataTableColumn<Person>["pinned"],
  onToggle: () => void,
): DataTableColumn<Person> => ({
  key: `${COLLAPSED_GROUP_KEY_PREFIX}${group.id}`,
  header: (
    <RosterGroupToggle
      label={group.label}
      expanded={false}
      iconPosition="end"
      onToggle={onToggle}
    />
  ),
  width: COLLAPSED_GROUP_WIDTH,
  minWidth: COLLAPSED_GROUP_WIDTH,
  pinned,
});

/** 套用欄位群組的收合:收合的那組換成一個窄欄(放在該組第一欄的位置),展開的那組第一欄表頭加 ▾。 */
const applyGroups = <Person,>(
  columns: readonly DataTableColumn<Person>[],
  groups: readonly RosterColumnGroup[],
  collapsed: ReadonlySet<string>,
  onToggleGroup: (groupId: string) => void,
): DataTableColumn<Person>[] =>
  columns.flatMap((column) => {
    const group = groups.find((g) => g.columnKeys.includes(column.key));
    if (group === undefined) return [column];
    const isFirst = group.columnKeys.find((key) =>
      columns.some((c) => c.key === key),
    );
    const toggle = () => {
      onToggleGroup(group.id);
    };
    if (collapsed.has(group.id)) {
      return isFirst === column.key
        ? [collapsedGroupColumn(group, column.pinned, toggle)]
        : [];
    }
    return isFirst === column.key
      ? [withExpandedToggle(column, group, toggle)]
      : [column];
  });

/**
 * 把班表的三段欄位組成(每次 render 重算,不存狀態) `DataTable` 的欄位:左固定(人員)→ 日期(中間捲動)→ 右固定(統計)。
 * 固定方向由所在段決定,模組不必自己標 `pinned`。
 */
export const useRosterColumns = <Person extends RowData>({
  leadingColumns,
  trailingColumns,
  dates,
  dateColumnWidth,
  renderDateCell,
  columnGroups,
  collapsedColumnGroups,
  onToggleGroup,
}: UseRosterColumnsOptions<Person>): DataTableColumn<Person>[] => {
  const collapsed = new Set(collapsedColumnGroups);
  const leading = leadingColumns.map((c) => ({
    ...c,
    pinned: "left" as const,
  }));
  const trailing = trailingColumns.map((c) => ({
    ...c,
    pinned: "right" as const,
  }));
  const dateColumns = dates.map((rosterDate): DataTableColumn<Person> => ({
    key: rosterDate.date,
    header: rosterDate.header,
    width: dateColumnWidth,
    minWidth: dateColumnWidth,
    headerSx: rosterDate.disabled ? disabledLayerSx : undefined,
    cellSx: {
      p: 0,
      // `height: 1px` 讓格子裡的 `height: 100%` 撐滿整列(表格格子的高度由列決定)
      height: "1px",
      verticalAlign: "top",
      whiteSpace: "normal",
      bgcolor: "background.paper",
      ...(rosterDate.disabled ? disabledLayerSx : {}),
    },
    render: ({ row, index }) =>
      renderDateCell({ person: row, date: rosterDate.date, index }),
  }));
  return applyGroups(
    [...leading, ...dateColumns, ...trailing],
    columnGroups,
    collapsed,
    onToggleGroup,
  );
};
