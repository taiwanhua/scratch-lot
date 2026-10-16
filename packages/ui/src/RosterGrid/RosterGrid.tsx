"use client";

import type { SxProps, Theme } from "@mui/material/styles";
import type { RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { DataTable } from "../DataTable/DataTable";
import type {
  DataTableColumn,
  DataTableColumnVisibility,
} from "../DataTable/data-table-column";
import { RosterCell } from "./RosterCell";
import {
  DEFAULT_DATE_COLUMN_WIDTH,
  buildRosterColumns,
} from "./roster-columns";
import type {
  RosterCellContext,
  RosterCellKey,
  RosterColumnGroup,
  RosterDate,
  RosterTopGroup,
} from "./roster-grid-types";
import { buildRosterTopRows } from "./roster-top-rows";

export type * from "./roster-grid-types";
export type {
  DataTableColumn,
  DataTableColumnVisibility,
} from "../DataTable/data-table-column";

const NO_COLUMNS: readonly never[] = [];
const NO_GROUP_IDS: readonly string[] = [];

export interface RosterGridProps<Person extends RowData> {
  /** 人員列(每列一人) */
  people: readonly Person[];
  getPersonKey: (person: Person) => string;
  /** 日期欄(中間可左右捲動的區域),依顯示順序 */
  dates: readonly RosterDate[];
  /** 左固定欄(人員欄…);固定方向由元件決定,不必標 `pinned` */
  leadingColumns: readonly DataTableColumn<Person>[];
  /** 右固定欄(統計欄…) */
  trailingColumns?: readonly DataTableColumn<Person>[];
  /** 日期格的內容(班別標籤…),由使用的模組決定 */
  renderCell: (ctx: RosterCellContext<Person>) => ReactNode;
  /** 日期欄寬(px);預設 128 */
  dateColumnWidth?: number;
  /** 選取中的格子(受控);`null` = 沒有 */
  selectedCell?: RosterCellKey | null;
  /** 點日期格(停用的日期不可點);沒給時格子不可點 */
  onCellClick?: (person: Person, date: string) => void;
  /**
   * 欄位顯示 / 隱藏(受控;key = 欄位 key 或日期)。元件沒有切換介面:使用的模組提供 [⚙ 顯示欄位],
   * 直接改這個值並存在瀏覽器
   */
  columnVisibility?: DataTableColumnVisibility;
  /** 可收合成一個窄欄的欄位群組 */
  columnGroups?: readonly RosterColumnGroup[];
  /** 收合中的群組 id(受控)。使用的模組存在瀏覽器 */
  collapsedColumnGroups?: readonly string[];
  onCollapsedColumnGroupsChange?: (groupIds: string[]) => void;
  /** 頂部固定群組(選用) */
  topGroup?: RosterTopGroup;
  /** 日期格的無障礙名稱;預設「<人員 key> <日期>」 */
  formatCellLabel?: (person: Person, date: string) => string;
  /** 頂部群組空白格的無障礙名稱;預設「<提示> <日期>」 */
  formatEmptyGroupCellLabel?: (date: string, rowKey: string) => string;
  isLoading?: boolean;
  emptyMessage?: ReactNode;
  /** 疊加到捲動容器上的樣式(虛擬捲動要確定的高度) */
  containerSx?: SxProps<Theme>;
  "aria-label"?: string;
}

/**
 * 班表(人 × 日期矩陣,《底座規格》10.5;Figma Draft/RosterGrid 366:7960):建在 `DataTable` 上,
 * 列虛擬捲動、左右固定欄(人員 / 統計)、中間日期區左右捲動、欄位顯示 / 隱藏、欄位群組收合成窄欄、
 * 頂部固定群組。格子內容由使用的模組決定;欄位顯示、群組收合、頂部群組收合都是受控值,
 * 元件不自己存(使用的模組存在瀏覽器)。
 */
export const RosterGrid = <Person extends RowData>({
  people,
  getPersonKey,
  dates,
  leadingColumns,
  trailingColumns = NO_COLUMNS,
  renderCell,
  dateColumnWidth = DEFAULT_DATE_COLUMN_WIDTH,
  selectedCell = null,
  onCellClick,
  columnVisibility,
  columnGroups = NO_COLUMNS,
  collapsedColumnGroups = NO_GROUP_IDS,
  onCollapsedColumnGroupsChange,
  topGroup,
  formatCellLabel = (person, date) => `${getPersonKey(person)} ${date}`,
  formatEmptyGroupCellLabel = (date) =>
    `${topGroup?.emptyCellHint ?? "+"} ${date}`,
  isLoading,
  emptyMessage,
  containerSx,
  "aria-label": ariaLabel,
}: RosterGridProps<Person>) => {
  const disabledDates = new Set(
    dates.filter((d) => d.disabled === true).map((d) => d.date),
  );

  const renderDateCell = ({
    person,
    date,
    index,
  }: RosterCellContext<Person>) => {
    const personKey = getPersonKey(person);
    const clickable = onCellClick !== undefined && !disabledDates.has(date);
    return (
      <RosterCell
        label={formatCellLabel(person, date)}
        selected={
          selectedCell?.personKey === personKey && selectedCell.date === date
        }
        onClick={
          clickable
            ? () => {
                onCellClick(person, date);
              }
            : undefined
        }
      >
        {renderCell({ person, date, index })}
      </RosterCell>
    );
  };

  const toggleGroup = (groupId: string) => {
    onCollapsedColumnGroupsChange?.(
      collapsedColumnGroups.includes(groupId)
        ? collapsedColumnGroups.filter((id) => id !== groupId)
        : [...collapsedColumnGroups, groupId],
    );
  };

  const columns = buildRosterColumns({
    leadingColumns,
    trailingColumns,
    dates,
    dateColumnWidth,
    renderDateCell,
    columnGroups,
    collapsedColumnGroups,
    columnVisibility,
    onToggleGroup: toggleGroup,
  });

  const labelColumnKey = leadingColumns.find(
    (column) => columnVisibility?.[column.key] !== false,
  )?.key;
  const topRows = buildRosterTopRows({
    group: topGroup,
    dates,
    labelColumnKey,
    emptyCellLabel: formatEmptyGroupCellLabel,
  });

  return (
    <DataTable
      columns={columns}
      rows={people}
      getRowKey={getPersonKey}
      topRows={topRows}
      columnVisibility={columnVisibility}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
      containerSx={containerSx}
      aria-label={ariaLabel}
    />
  );
};
