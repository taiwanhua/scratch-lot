import { Fragment, type ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn, type TableProps } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

/** 手機卡片怎麼排(欄位一律用 `columns` 的 key,表格與卡片同一份欄位宣告)。 */
export interface AccountsCardLayout {
  /** 標題列:這幾欄依序以「 · 」相接 */
  title: readonly string[];
  /** 標題列右側(狀態 / 差額標籤) */
  tag?: string;
  /** 卡片底部靠右(列內按鈕) */
  actions?: string;
}

export interface AccountsListProps<Row> extends TableProps<Row> {
  card: AccountsCardLayout;
}

/** 空字串 / null 的欄位在卡片上不佔一行(例:交易的「收」「支」只有一邊有值)。 */
const BLANKS: ReadonlySet<unknown> = new Set([null, undefined, false, ""]);
const isBlank = (node: ReactNode): boolean => BLANKS.has(node);

/**
 * 帳戶管理的清單(規格 16.0「列表的表格在手機改成卡片」;Figma RW-01 131:1815):
 * 平板以上照舊 `Table`;手機(< sm)每列一張卡片 —— 標題列(`card.title` 幾欄 + 右側 `card.tag`)、
 * 其餘欄位一行一個「表頭 … 值」(值靠右,金額自然右對齊)、`card.actions` 的按鈕在卡片底部靠右。
 * 整列可點(`onRowClick`)時整張卡片可點;卡片清單沿用表格的 `aria-label`。
 */
export const AccountsList = <Row,>({
  card,
  ...table
}: AccountsListProps<Row>) => {
  const isMobile = useBreakpointDown("sm");
  if (!isMobile) {
    return <Table {...table} />;
  }
  const {
    columns,
    rows,
    getRowKey,
    isLoading = false,
    emptyMessage,
    onRowClick,
  } = table;
  if (isLoading) {
    return <CircularProgress aria-label={table["aria-label"]} />;
  }
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyMessage}
      </Typography>
    );
  }
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const special = new Set<string>([
    ...card.title,
    ...(card.tag === undefined ? [] : [card.tag]),
    ...(card.actions === undefined ? [] : [card.actions]),
  ]);
  const lines = columns.filter((column) => !special.has(column.key));
  const cell = (
    column: TableColumn<Row> | undefined,
    row: Row,
    index: number,
  ) => {
    if (column === undefined) {
      return null;
    }
    const { accessor } = column;
    let value: unknown;
    if (typeof accessor === "function") {
      value = accessor(row);
    } else if (accessor !== undefined) {
      value = row[accessor];
    }
    return column.render(row, { value, row, rows, index, column });
  };

  return (
    <Stack
      role="list"
      aria-label={table["aria-label"]}
      spacing={1.5}
      sx={{ height: "100%", overflow: "auto" }}
    >
      {rows.map((row, index) => {
        const titles = card.title
          .map((key) => ({ key, node: cell(byKey.get(key), row, index) }))
          .filter(({ node }) => !isBlank(node));
        const actions = cell(
          card.actions === undefined ? undefined : byKey.get(card.actions),
          row,
          index,
        );
        return (
          <Box key={getRowKey(row)} role="listitem" sx={{ flexShrink: 0 }}>
            <Card
              variant="outlined"
              {...(onRowClick === undefined
                ? {}
                : {
                    role: "button",
                    tabIndex: 0,
                    onClick: () => {
                      onRowClick(row);
                    },
                    onKeyDown: (event: { key: string }) => {
                      if (event.key === "Enter") {
                        onRowClick(row);
                      }
                    },
                  })}
              sx={{
                px: 2,
                py: 1.5,
                cursor: onRowClick === undefined ? undefined : "pointer",
              }}
            >
              <Stack spacing={0.5}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", justifyContent: "space-between" }}
                >
                  <Box
                    sx={{
                      typography: "subtitle2",
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      columnGap: 0.5,
                      minWidth: 0,
                    }}
                  >
                    {titles.map(({ key, node }, position) => (
                      <Fragment key={key}>
                        {position > 0 && <span aria-hidden>·</span>}
                        {node}
                      </Fragment>
                    ))}
                  </Box>
                  {card.tag !== undefined &&
                    cell(byKey.get(card.tag), row, index)}
                </Stack>
                {lines.map((column) => {
                  const value = cell(column, row, index);
                  return isBlank(value) ? null : (
                    <Stack
                      key={column.key}
                      direction="row"
                      spacing={2}
                      sx={{
                        justifyContent: "space-between",
                        alignItems: "baseline",
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {column.header}
                      </Typography>
                      <Box
                        sx={{
                          typography: "body2",
                          textAlign: "right",
                          minWidth: 0,
                        }}
                      >
                        {value}
                      </Box>
                    </Stack>
                  );
                })}
                {!isBlank(actions) && (
                  // 列內按鈕的點擊 / Enter 不冒泡到整張卡片的 onRowClick
                  <Stack
                    direction="row"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                    }}
                    sx={{ justifyContent: "flex-end" }}
                  >
                    {actions}
                  </Stack>
                )}
              </Stack>
            </Card>
          </Box>
        );
      })}
    </Stack>
  );
};
