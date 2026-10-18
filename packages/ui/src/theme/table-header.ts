import type { CSSObject, Theme } from "@mui/material/styles";

/**
 * 表頭格的外觀(Figma Draft/TableHeaderCell):`text.secondary` 字、`background.default` 底、粗體 600。
 * 正本只有這一份:主題的 `MuiTableCell` head 覆寫(`Table` / `DataTable` 的表頭)與
 * `ScheduleTimeline` 的表頭(div,不是表格,不能帶 TableCell 的 `scope`)都讀它,改一邊另一邊跟著變。
 * 本檔是 ui 內部用的(同 `state-layer.ts`),不從 `theme/index.ts` 匯出。
 */
export const tableHeaderSx = (theme: Theme): CSSObject => {
  const { palette } = theme.vars ?? theme;
  return {
    color: palette.text.secondary,
    backgroundColor: palette.background.default,
    fontWeight: 600,
  };
};
