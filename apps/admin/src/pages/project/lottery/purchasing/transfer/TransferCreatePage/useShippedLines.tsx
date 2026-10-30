import { useState } from "react";
import { useTranslations } from "use-intl";

import { COLLATION_LOCALE } from "@repo/domain/collation";
import { TRANSFER_MODE, type TransferMode } from "@repo/domain/project/lottery";
import type { LotteryTransferReceivingFieldsFragment } from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { BookListRow } from "@/components/project/lottery/BookGroupList/BookGroupList";
import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import { ticketListText } from "@/lib/project/lottery/ticket-list-text";

import type { TransferDraftLine } from "./transfer-form";

type ReceivingRow = LotteryTransferReceivingFieldsFragment["rows"][number];

/** 已出貨、還沒到齊的一列(編輯頁:被退回時保持在途;選張的列可以移除沒到的張)。 */
export interface ShippedRowFacts {
  rowId: string;
  /** 顯示用本號(開頭 0 去掉) */
  bookNo: string;
  mode: TransferMode;
  /** 出貨的張號 */
  ticketNos: readonly string[];
  /** 已點收的張號(鎖住,不能移除) */
  receivedNos: readonly string[];
  tickets: number;
}

const displayBookNo = (bookNo: string): string =>
  bookNo.startsWith("0") ? bookNo.slice(1) : bookNo;

/**
 * 點收區塊的列 → 已出貨、還沒到齊的列(全部到齊的列整列鎖住,不在這裡);只看這張單原本的列
 * (`rowIds` = 帶入的明細)。
 */
export const shippedRowsOf = (
  rows: readonly ReceivingRow[],
  rowIds: ReadonlySet<string>,
): Map<string, ShippedRowFacts> =>
  new Map(
    rows
      .filter((row) => row.shipped && !row.received && rowIds.has(row.rowId))
      .map((row) => [
        row.rowId,
        {
          rowId: row.rowId,
          bookNo: displayBookNo(row.bookNo),
          mode:
            row.mode === TRANSFER_MODE.partial
              ? TRANSFER_MODE.partial
              : TRANSFER_MODE.whole,
          ticketNos: row.ticketNos,
          receivedNos: row.receivedTicketNos,
          tickets: row.tickets,
        },
      ]),
  );

/** 送出後會變待查的(取消勾選的在途張、整列移除的在途列)。 */
interface Dropped {
  bookNo: string;
  /** 選張的張號;整列移除的整本 = null */
  ticketNos: readonly string[] | null;
  count: number;
}

const droppedOf = (
  lines: readonly TransferDraftLine[],
  shipped: ReadonlyMap<string, ShippedRowFacts>,
): Dropped[] =>
  [...shipped.values()].flatMap((row): Dropped[] => {
    const line = lines.find((item) => item.rowId === row.rowId);
    const received = new Set(row.receivedNos);
    const inTransit = row.ticketNos.filter((no) => !received.has(no));
    if (line === undefined) {
      return row.mode === TRANSFER_MODE.whole
        ? [{ bookNo: row.bookNo, ticketNos: null, count: row.tickets }]
        : [
            {
              bookNo: row.bookNo,
              ticketNos: inTransit,
              count: inTransit.length,
            },
          ];
    }
    const kept = new Set(line.ticketNos);
    const dropped =
      row.mode === TRANSFER_MODE.partial && line.mode === TRANSFER_MODE.partial
        ? inTransit.filter((no) => !kept.has(no))
        : [];
    return dropped.length === 0
      ? []
      : [{ bookNo: row.bookNo, ticketNos: dropped, count: dropped.length }];
  });

/**
 * 編輯頁(被退回)已出貨的列(專案規格 8.4「少張處理」;使用者 10/26 定案做法 A):選張的列展開格子,
 * 已點收的張鎖住、還沒點收的可以**取消勾選**(沒到的張);送出前列出會變成待查的張(取消勾選的、整列移除的在途列)
 * 請操作者確認。金額照剩下的張數重算(`lineAmountOf`)。
 */
export const useShippedLines = (
  lines: readonly TransferDraftLine[],
  setLines: (
    update: (current: TransferDraftLine[]) => TransferDraftLine[],
  ) => void,
  shipped: ReadonlyMap<string, ShippedRowFacts>,
) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.edit");
  const tView = useTranslations("admin.lotteryPurchasing.transfer.view");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const keep = (row: ShippedRowFacts, kept: readonly string[]) => {
    const next = [...new Set([...row.receivedNos, ...kept])].toSorted((a, b) =>
      a.localeCompare(b, COLLATION_LOCALE),
    );
    // 至少留一張(全部沒到 → 整列移除)
    if (next.length === 0) {
      return;
    }
    setLines((current) =>
      current.map((line) =>
        line.rowId === row.rowId ? { ...line, ticketNos: next } : line,
      ),
    );
  };

  /** 一列的狀態文字與格子(選張、已出貨的列);其他列 = 不加。 */
  const rowExtrasOf = (
    line: TransferDraftLine,
  ): Pick<BookListRow, "statusLabel" | "panel"> => {
    const row = shipped.get(line.rowId);
    if (
      row?.mode !== TRANSFER_MODE.partial ||
      line.mode !== TRANSFER_MODE.partial
    ) {
      return {};
    }
    const received = new Set(row.receivedNos);
    const kept = line.ticketNos.filter((no) => !received.has(no));
    const cells: TicketGridCell[] = row.ticketNos.map((ticketNo) => ({
      ticketNo,
      state: received.has(ticketNo) ? "sold" : "unsold",
    }));
    const isOpen = expanded.has(line.rowId);
    const dropped = row.ticketNos.length - received.size - kept.length;
    return {
      ...(received.size > 0 && {
        statusLabel: tView("rowStatus.partial", {
          received: received.size,
          total: row.tickets,
        }),
      }),
      panel: {
        isOpen,
        toggleLabel: isOpen ? t("shrink.collapse") : t("shrink.expand"),
        onToggle: () => {
          setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(line.rowId)) {
              next.add(line.rowId);
            }
            return next;
          });
        },
        content: (
          <Stack spacing={1}>
            <Typography variant="body2" color="textSecondary">
              {t("shrink.hint")}
            </Typography>
            <TicketGrid
              cells={cells}
              selectableStates={["unsold"]}
              selected={kept}
              onSelectedChange={(next) => {
                keep(row, next);
              }}
              legendItems={["selected", "unsold", "sold"]}
              labels={{
                selected: t("shrink.kept"),
                unsold: t("shrink.dropped"),
                sold: t("shrink.received"),
              }}
              quickSelect={false}
              summary={t("shrink.summary", { kept: kept.length, dropped })}
            />
          </Stack>
        ),
      },
    };
  };

  const dropped = droppedOf(lines, shipped);
  const total = dropped.reduce((sum, item) => sum + item.count, 0);
  const isSingle = dropped.length === 1 && dropped[0]?.ticketNos !== null;
  /** 送出前的確認句;沒有會變成待查的 → null。 */
  const confirmText =
    dropped.length === 0
      ? null
      : t("dropConfirm.body", {
          count: total,
          tickets: isSingle
            ? ticketListText(dropped[0]?.ticketNos ?? [])
            : dropped
                .map((item) =>
                  item.ticketNos === null
                    ? t("dropConfirm.whole", { bookNo: item.bookNo })
                    : t("dropConfirm.item", {
                        bookNo: item.bookNo,
                        tickets: ticketListText(item.ticketNos),
                      }),
                )
                .join(t("dropConfirm.separator")),
        });

  return { rowExtrasOf, confirmText };
};
