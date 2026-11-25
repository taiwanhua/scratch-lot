/** 營運報表的期初建檔(期初建檔規格 5.1):區塊 4 的「期初建檔」列、區塊 8 的建檔期間註記。 */
import { formatTemporal } from "@repo/domain/form";

import type { SheetRow } from "@/lib/base/reports/excel";

import {
  type OperationsStore,
  type SheetOptions,
  type T,
  line,
} from "./operations-row-base";

/**
 * 區塊 4 的「期初庫存」與「期初建檔」列(放在「進貨」之前):期初建檔只算事件後在手上的張(期初已售、
 * 跳號不算;改回未售 +、改成期初已售 −、作廢 −)。這一期沒有建檔、作廢或期初更正 → 不放期初建檔。
 */
export const openingRows = (store: OperationsStore, t: T): SheetRow[] => {
  const inv = store.inventory;
  const opening = line({
    item: t("admin.lotteryReports.operations.items.opening"),
    tickets: inv.openingTickets,
    cost: inv.openingCost,
  });
  if (
    inv.openingEntryBooks === 0 &&
    inv.openingEntryVoidBooks === 0 &&
    inv.openingEntryFixTickets === 0
  ) {
    return [opening];
  }
  return [
    opening,
    line({
      item: t("admin.lotteryReports.operations.items.openingEntry"),
      tickets: inv.openingEntryTickets,
      cost: inv.openingEntryCost,
      note: t("admin.lotteryReports.operations.items.openingEntryNote", {
        books: inv.openingEntryBooks,
        fix: inv.openingEntryFixTickets,
        voided: inv.openingEntryVoidBooks,
      }),
    }),
  ];
};

/**
 * 區塊 8「期初建檔」:「這家店 MM/DD 開始期初建檔;MM/DD 結束」(還沒結束寫「進行中」),讀者看得出
 * 這一期的銷售從哪一天開始算。到期末還沒建過任何一本 → 不放。
 */
export const openingEntryNoteRows = (
  store: OperationsStore,
  t: T,
  options: SheetOptions,
): SheetRow[] => {
  const entry = store.notes.openingEntry;
  if (entry == null) {
    return [];
  }
  const day = (value: string) =>
    formatTemporal(value, { type: "monthDay", timezone: options.timezone });
  return [
    line({
      item: t("admin.lotteryReports.operations.items.openingEntryPeriod"),
      note:
        entry.closedAt == null
          ? t("admin.lotteryReports.operations.items.openingEntryOngoing", {
              start: day(entry.startedAt),
            })
          : t("admin.lotteryReports.operations.items.openingEntryClosed", {
              start: day(entry.startedAt),
              end: day(entry.closedAt),
            }),
    }),
  ];
};
