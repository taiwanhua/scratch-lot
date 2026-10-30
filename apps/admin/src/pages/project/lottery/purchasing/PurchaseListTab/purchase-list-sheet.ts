import type { LotteryPurchaseListQuery } from "@repo/graphql";

import type { SheetColumn, SheetData } from "@/lib/base/reports/excel";

/** 採購清單(`lotteryPurchaseList`)。 */
export type PurchaseList = LotteryPurchaseListQuery["lotteryPurchaseList"];

export interface PurchaseListLabels {
  sheetName: string;
  note: string;
  game: string;
  totalBooks: string;
  estimatedAmount: string;
  /** 遊戲欄的文字(代號 名稱 面額) */
  gameLabel: (row: PurchaseList["rows"][number]) => string;
}

/** 分店欄的 key(依 orgId)。 */
export const branchKeyOf = (orgId: string): string => `org:${orgId}`;

/**
 * 採購清單 → 一個工作表(規格 8.1、11.4;畫面的表格與 [匯出 Excel] 同一份):
 * 遊戲、每家分店的本數(沒有叫 = 空格,畫面顯示「—」)、合計本數、預估批購金額。
 */
export const purchaseListSheetOf = (
  list: PurchaseList,
  orgNameOf: (orgId: string) => string,
  labels: PurchaseListLabels,
): SheetData => {
  const columns: SheetColumn[] = [
    { key: "game", header: labels.game, width: 28 },
    ...list.orgIds.map((orgId): SheetColumn => ({
      key: branchKeyOf(orgId),
      header: orgNameOf(orgId),
      width: 12,
      numFmt: "#,##0",
      align: "right",
    })),
    {
      key: "totalBooks",
      header: labels.totalBooks,
      width: 12,
      numFmt: "#,##0",
      align: "right",
    },
    {
      key: "estimatedAmount",
      header: labels.estimatedAmount,
      width: 16,
      numFmt: "#,##0",
      align: "right",
    },
  ];
  return {
    name: labels.sheetName,
    notes: [labels.note],
    columns,
    rows: list.rows.map((row) => ({
      game: labels.gameLabel(row),
      ...Object.fromEntries(
        list.orgIds.map((orgId) => [
          branchKeyOf(orgId),
          row.branches.find((branch) => branch.orgId === orgId)?.books ?? null,
        ]),
      ),
      totalBooks: row.totalBooks,
      estimatedAmount: row.estimatedAmount,
    })),
  };
};
