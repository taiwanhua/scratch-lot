import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { RateInput } from "./RateInput";

/**
 * 使用處決定的模式(專案規格 8.2、8.4):
 *
 * - `create`:新增頁;每本可改批購金額率、可移除
 * - `edit`:編輯頁(草稿 / 被退回);`isLocked` 的列(已點收 / 已出貨)唯讀、標狀態,其他列同新增
 * - `receive`:點收(點收關卡、任務在手上);唯讀,每本顯示點收了沒,刷條碼列由使用處給
 * - `view`:其他人 / 其他關卡;唯讀顯示狀態,不給刷條碼列
 */
export type BookListMode = "create" | "edit" | "receive" | "view";

/** 一本的狀態(顏色由這個元件固定;文字由使用處給)。 */
export type BookRowStatus = "received" | "notReceived" | "inTransit";

const STATUS_TONE: Record<BookRowStatus, TagTone> = {
  received: "success",
  notReceived: "grey",
  inTransit: "primary",
};

/** 清單的一本。 */
export interface BookListRow {
  rowId: string;
  /** 顯示用本號(開頭 0 去掉) */
  bookNo: string;
  /** 張號欄(進貨單 = 最後張號 3 位;調貨單 = 張號區段) */
  ticketText: string;
  /** 本號下面的說明(例 調貨單的方式「選張」);不給 = 沒有 */
  detail?: string;
  tickets: number;
  /** 整本金額(調貨單 = 這列的金額) */
  bookPrice: number;
  rate: number;
  /** 批購金額 */
  amount: number;
  /** 批購金額率和預設不同(標色) */
  isRateEdited?: boolean;
  /** 狀態;null / 不給 = 不顯示 */
  status?: BookRowStatus | null;
  /** 編輯模式:鎖住(不能改批購金額率、不能移除) */
  isLocked?: boolean;
  /**
   * 鎖住的列仍可移除(例 調貨單在途的列:路上遺失時刪掉再送出 → 待查,規格 8.4);
   * 不給 = 鎖住就不能移除
   */
  isRemovable?: boolean;
}

/** 一組(同一個遊戲)。 */
export interface BookListGroup {
  key: string;
  /** 組標題(例「5164 發大財 · 200 元(2 本)小計 36,800」) */
  title: string;
  /** 從叫貨單帶入時這個遊戲叫了幾本;沒有叫貨單(或不知道)= null / 不給 */
  requestedBooks?: number | null;
  rows: readonly BookListRow[];
  /** 整組的批購金額率(新增 / 編輯);不給 = 不顯示 */
  groupRate?: {
    value: number;
    label: string;
    onChange: (rate: number) => void;
  };
}

export type BookListColumn =
  "bookNo" | "ticket" | "tickets" | "bookPrice" | "rate" | "amount" | "status";

/**
 * 組標題旁的進度(四種模式同一條規則,只給適用的部分):有叫貨單 →「叫貨 N」;一律「已刷 M」(單上本數);
 * 有點收資訊時(點收 / 檢視的列帶點收狀態、編輯有已點收的列)→「已點收 X / M」。
 */
export interface BookGroupProgress {
  requested: number | null;
  scanned: number;
  received: { count: number; total: number } | null;
}

/** 使用處的詞(欄名、狀態、按鈕;先盤點所有使用處,不在元件裡寫死)。 */
export interface BookListLabels {
  columns: Record<BookListColumn, string>;
  status: Record<BookRowStatus, string>;
  /** [移除](新增 / 編輯) */
  remove: string;
  /** 每本批購金額率輸入框的無障礙名稱 */
  rateOf: (row: BookListRow) => string;
  /** 整組批購金額率的說明(組標題列) */
  groupRate?: string;
  /** 手機卡片的第二行 */
  cardFacts: (row: BookListRow) => string;
  /** 組標題的進度文字(`useBookProgressLabel`) */
  progress: (progress: BookGroupProgress) => string;
  /** 一本都沒有時 */
  empty?: string;
  /** 表格的無障礙名稱(組標題以外再補;不給 = 組標題) */
  tableAria?: (group: BookListGroup) => string;
}

export interface BookGroupListProps {
  mode: BookListMode;
  /** 區塊標題(例「明細」「點收」「出貨確認清單」) */
  title: string;
  groups: readonly BookListGroup[];
  labels: BookListLabels;
  /** 刷條碼列(`BookScanBar`;新增 / 編輯 / 點收);`view` 不給 */
  scanBar?: ReactNode;
  /** 標題列右邊(例 [列印]) */
  actions?: ReactNode;
  /** 明細上方的提示(例 編輯頁「已點收的本不能修改…」、超過預計要給本數、欄位錯誤) */
  notice?: ReactNode;
  /** 清單下方(例 調貨金額) */
  footer?: ReactNode;
  onRate?: (rowId: string, rate: number) => void;
  onRemove?: (rowId: string) => void;
}

const money = (value: number): string => value.toLocaleString("en-US");

/**
 * 依遊戲分組的本清單(專案規格 8.2 明細 / 點收一本、8.4;進貨單與調貨單的新增、編輯、出貨確認、點收、檢視共用):
 * 組標題(+ 進度、整組批購金額率)→ 每本一列;電腦表格、平板 / 手機卡片(同一個斷點,所有模式一樣)。
 * 能不能改由 `mode` 與每列的 `isLocked` 決定;狀態的顏色固定在這裡,文字由使用處的 `labels` 給。
 */
export const BookGroupList = ({
  mode,
  title,
  groups,
  labels,
  scanBar,
  actions,
  notice,
  footer,
  onRate,
  onRemove,
}: BookGroupListProps) => {
  const isCompact = useBreakpointDown("lg");
  const isFillable = mode === "create" || mode === "edit";
  const canEdit = (row: BookListRow): boolean =>
    isFillable && row.isLocked !== true;
  const hasStatus = groups.some((group) =>
    group.rows.some((row) => row.status !== null && row.status !== undefined),
  );
  const isEmpty = groups.every((group) => group.rows.length === 0);
  const progressOf = (group: BookListGroup): string => {
    const received = group.rows.filter(
      (row) => row.status === "received",
    ).length;
    const hasReceiving =
      mode === "edit"
        ? received > 0
        : mode !== "create" &&
          group.rows.some(
            (row) => row.status === "received" || row.status === "notReceived",
          );
    return labels.progress({
      requested: group.requestedBooks ?? null,
      scanned: group.rows.length,
      received: hasReceiving
        ? { count: received, total: group.rows.length }
        : null,
    });
  };

  const statusTag = (row: BookListRow) =>
    row.status === null || row.status === undefined ? null : (
      <Tag tone={STATUS_TONE[row.status]} label={labels.status[row.status]} />
    );
  const rateCell = (row: BookListRow) =>
    canEdit(row) && onRate !== undefined ? (
      <RateInput
        label={labels.rateOf(row)}
        value={row.rate}
        isEdited={row.isRateEdited === true}
        onChange={(rate) => {
          onRate(row.rowId, rate);
        }}
      />
    ) : (
      `${String(row.rate)}%`
    );
  const removeButton = (row: BookListRow) =>
    (canEdit(row) || (isFillable && row.isRemovable === true)) &&
    onRemove !== undefined ? (
      <Button
        variant="text"
        size="small"
        color="error"
        aria-label={`${labels.remove} ${row.bookNo}`}
        onClick={() => {
          onRemove(row.rowId);
        }}
      >
        {labels.remove}
      </Button>
    ) : null;

  const columns: TableColumn<BookListRow>[] = [
    {
      key: "bookNo",
      header: labels.columns.bookNo,
      isEmphasized: true,
      render: (row) =>
        row.detail === undefined ? (
          row.bookNo
        ) : (
          <Stack spacing={0.25}>
            <span>{row.bookNo}</span>
            <Typography variant="caption" color="textSecondary">
              {row.detail}
            </Typography>
          </Stack>
        ),
    },
    {
      key: "ticket",
      header: labels.columns.ticket,
      render: (row) => row.ticketText,
    },
    {
      key: "tickets",
      header: labels.columns.tickets,
      align: "right",
      render: (row) => money(row.tickets),
    },
    {
      key: "bookPrice",
      header: labels.columns.bookPrice,
      align: "right",
      render: (row) => money(row.bookPrice),
    },
    {
      key: "rate",
      header: labels.columns.rate,
      align: "right",
      render: rateCell,
    },
    {
      key: "amount",
      header: labels.columns.amount,
      align: "right",
      render: (row) => money(row.amount),
    },
    ...(hasStatus
      ? [
          {
            key: "status",
            header: labels.columns.status,
            render: statusTag,
          } satisfies TableColumn<BookListRow>,
        ]
      : []),
    ...(isFillable
      ? [
          {
            key: "remove",
            header: "",
            width: 72,
            render: removeButton,
          } satisfies TableColumn<BookListRow>,
        ]
      : []),
  ];

  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { sm: "center" } }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
            {title}
          </Typography>
          {actions}
        </Stack>
        {scanBar}
        {notice}
        {isEmpty && labels.empty !== undefined && (
          <Typography variant="body2" color="textSecondary">
            {labels.empty}
          </Typography>
        )}
        {groups.map((group) => (
          <Stack key={group.key} spacing={1}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
            >
              <Typography
                variant="subtitle2"
                component="h3"
                sx={{ flex: 1, minWidth: 200 }}
              >
                {group.title}
                <Typography
                  component="span"
                  variant="body2"
                  color="textSecondary"
                  sx={{ ml: 1 }}
                >
                  {progressOf(group)}
                </Typography>
              </Typography>
              {isFillable &&
                group.groupRate !== undefined &&
                group.rows.some((row) => canEdit(row)) && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    {labels.groupRate !== undefined && (
                      <Typography variant="caption" color="textSecondary">
                        {labels.groupRate}
                      </Typography>
                    )}
                    <RateInput
                      label={group.groupRate.label}
                      value={group.groupRate.value}
                      isEdited={false}
                      onChange={group.groupRate.onChange}
                    />
                  </Stack>
                )}
            </Stack>
            {group.rows.length > 0 &&
              (isCompact ? (
                <Stack spacing={1}>
                  {group.rows.map((row) => (
                    <Card key={row.rowId} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center" }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {row.detail === undefined
                              ? row.bookNo
                              : `${row.bookNo} · ${row.detail}`}
                          </Typography>
                          <Typography variant="caption" color="textSecondary">
                            {labels.cardFacts(row)}
                          </Typography>
                        </Box>
                        {statusTag(row)}
                        {canEdit(row) && rateCell(row)}
                        {removeButton(row)}
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              ) : (
                <Table
                  aria-label={labels.tableAria?.(group) ?? group.title}
                  size="small"
                  columns={columns}
                  rows={group.rows}
                  getRowKey={(row) => row.rowId}
                  minWidth={760}
                  containerSx={{ height: "auto" }}
                />
              ))}
          </Stack>
        ))}
        {footer}
      </Stack>
    </Card>
  );
};
