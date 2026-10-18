import { type ReactNode, createElement } from "react";

import { Box } from "../Box/Box";
import type { DataTableTopRow } from "../DataTable/DataTableTopRows";
import { RosterEmptyGroupCell } from "./RosterEmptyGroupCell";
import { RosterGroupSummaryCell } from "./RosterGroupSummaryCell";
import { RosterGroupToggle } from "./RosterGroupToggle";
import type {
  RosterDate,
  RosterTopGroup,
  RosterTopGroupRow,
} from "./roster-grid-types";

export interface BuildRosterTopRowsOptions {
  /** 沒有頂部群組時回 `undefined` */
  group: RosterTopGroup | undefined;
  dates: readonly RosterDate[];
  /** 標題與列名放在哪一欄(第一個看得到的左固定欄) */
  labelColumnKey: string | undefined;
  /** 空白格的無障礙名稱 */
  emptyCellLabel: (date: string, rowKey: string) => string;
}

/** 日期格的內容留一點內距(日期欄的表格格子本身是 0 內距,讓排程格子能貼滿)。 */
const padded = (content: ReactNode) =>
  createElement(Box, { sx: { p: 0.5 } }, content);

/**
 * 頂部固定群組 → `DataTable` 的 `topRows`(純函式,每次 render 重算):
 * - 收合:一列,標題(▸)+ 每天一格彙總;
 * - 展開:標題列(▾)+ 每一列(列名 + 每天的格子;空白格可點、滑過顯示提示)。
 * 停用的日期格子留空。
 */
export const buildRosterTopRows = ({
  group,
  dates,
  labelColumnKey,
  emptyCellLabel,
}: BuildRosterTopRowsOptions): DataTableTopRow[] | undefined => {
  if (group === undefined) return undefined;
  const dateByKey = new Map(dates.map((d) => [d.date, d]));
  const title = createElement(RosterGroupToggle, {
    label: group.title,
    expanded: !group.collapsed,
    onToggle: () => {
      group.onCollapsedChange(!group.collapsed);
    },
  });
  const summaryCell = (columnKey: string): ReactNode => {
    const summary = dateByKey.get(columnKey)?.disabled
      ? undefined
      : group.summary[columnKey];
    let content: ReactNode = null;
    if (columnKey === labelColumnKey) content = title;
    else if (summary !== undefined)
      content = padded(createElement(RosterGroupSummaryCell, { summary }));
    return content;
  };
  if (group.collapsed) {
    return [{ key: "roster-group-summary", renderCell: summaryCell }];
  }
  const { onEmptyCellClick } = group;
  const rowCell = (row: RosterTopGroupRow, columnKey: string): ReactNode => {
    const rosterDate = dateByKey.get(columnKey);
    // 不是日期欄(人員欄以外的固定欄)或停用日:留空
    const isOpenDate = rosterDate !== undefined && rosterDate.disabled !== true;
    const cell = row.cells[columnKey];
    let content: ReactNode = null;
    if (columnKey === labelColumnKey) content = row.label;
    else if (!isOpenDate) return content;
    else if (cell !== undefined) content = padded(cell);
    else if (onEmptyCellClick !== undefined)
      content = createElement(RosterEmptyGroupCell, {
        hint: group.emptyCellHint,
        label: emptyCellLabel(columnKey, row.key),
        onClick: () => {
          onEmptyCellClick(columnKey, row.key);
        },
      });
    return content;
  };
  return [
    {
      key: "roster-group-title",
      renderCell: (columnKey): ReactNode =>
        columnKey === labelColumnKey ? title : null,
    },
    ...group.rows.map((row): DataTableTopRow => ({
      key: `roster-group-row:${row.key}`,
      renderCell: (columnKey) => rowCell(row, columnKey),
    })),
  ];
};
