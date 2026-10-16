import type { SxProps, Theme } from "@mui/material/styles";
import type { Column, RowData } from "@tanstack/react-table";

import type { DataTableFeatures } from "./useDataTable";

/** 固定欄在畫面上的位置:貼哪一邊、離那一邊多遠、是不是與捲動區相鄰的那一欄。 */
export interface PinnedPlacement {
  side: "left" | "right";
  offset: number;
  /** 與捲動區相鄰(左固定的最後一欄、右固定的第一欄):畫分隔陰影 */
  isEdge: boolean;
}

/** 由 TanStack 的 pinning 狀態算出某欄的固定位置;沒固定回 `undefined`。 */
export const pinnedPlacementOf = <Row extends RowData>(
  column: Column<DataTableFeatures, Row>,
  startIds: readonly string[],
  endIds: readonly string[],
): PinnedPlacement | undefined => {
  const pinned = column.getIsPinned();
  if (pinned === "start") {
    return {
      side: "left",
      offset: column.getStart("start"),
      isEdge: startIds.at(-1) === column.id,
    };
  }
  if (pinned === "end") {
    return {
      side: "right",
      offset: column.getAfter("end"),
      isEdge: endIds[0] === column.id,
    };
  }
  return undefined;
};

/**
 * 固定欄的 sticky 樣式。表身的固定格要不透明底色(否則捲過去的內容會透出來),
 * 列 hover 時用疊一層 `action.hover` 的漸層維持與未固定格一致的回饋。
 * 表頭格本來就有 theme 給的底色(`MuiTableCell.head`)且已是 `stickyHeader` 的 sticky,
 * 只補水平位置與較高的層級。
 */
export const pinnedCellSx =
  (placement: PinnedPlacement | undefined, isHeader: boolean): SxProps<Theme> =>
  (theme) => {
    if (placement === undefined) {
      return {};
    }
    // cssVariables 開著時取 `vars`(深色模式跟著切),否則退回 palette 本身(STYLE-04)
    const { palette } = theme.vars ?? theme;
    const { divider } = palette;
    // Figma 尚無 DataTable 稿:分隔陰影 = 1px 分隔線 + 6px 向外的柔影(STYLE-06 一次性直寫)
    const edgeShadow =
      placement.side === "left"
        ? `inset -1px 0 0 ${divider}, 6px 0 6px -6px ${divider}`
        : `inset 1px 0 0 ${divider}, -6px 0 6px -6px ${divider}`;
    const hover = palette.action.hover;
    return {
      position: "sticky",
      [placement.side]: placement.offset,
      zIndex: isHeader ? 3 : 1,
      ...(placement.isEdge ? { boxShadow: edgeShadow } : {}),
      ...(isHeader
        ? {}
        : {
            backgroundColor: palette.background.paper,
            ".MuiTableRow-hover:hover > &": {
              backgroundImage: `linear-gradient(${hover}, ${hover})`,
            },
          }),
    };
  };
