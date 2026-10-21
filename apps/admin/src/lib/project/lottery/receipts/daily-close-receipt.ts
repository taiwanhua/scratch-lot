import type { LotteryCheckoutQuery } from "@repo/graphql";

import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  receiptMoney,
} from "./receipt-layout";
import {
  type ReceiptStocktake,
  type ReceiptTimeText,
  differenceTextOf,
  receiptStocktakeOf,
  stocktakeTextOf,
} from "./shift-checkout-receipt";
import { receiptSignedMoney } from "./store-receipts";

type CheckoutDetail = LotteryCheckoutQuery["lotteryCheckout"];

export interface DailyCloseReceiptInput {
  /** 結帳確認申請(類型 = 日結)的提交 id:列印紀錄的 `refId`,QR 連到檢視頁 */
  submissionId: string;
  serialNo: string | null;
  branchId: string;
  /** 涵蓋計算期間(已格式化;第一次日結沒有起點 = null) */
  periodFrom: string | null;
  periodTo: string;
  stocktake: ReceiptStocktake;
  /** 涵蓋計算的班(收銀點、這一班的差額);單據依收銀點彙總 */
  shifts: readonly { cashPointName: string; difference: number }[];
  /** 小金庫應有 / 實點 / 差額 */
  expected: number;
  counted: number;
  difference: number;
  diffReason: string | null;
  /** 存入銀行(0 = 不存)與帳戶名稱 */
  bankDepositAmount: number;
  bankAccountName: string | null;
  submittedAt: string;
  url: string;
}

/** 涵蓋的班依收銀點彙總(順序 = 第一次出現的順序):班數、差額合計。 */
export const shiftsByCashPoint = (
  shifts: DailyCloseReceiptInput["shifts"],
): { cashPointName: string; count: number; difference: number }[] => {
  const groups = new Map<string, { count: number; difference: number }>();
  for (const shift of shifts) {
    const group = groups.get(shift.cashPointName) ?? {
      count: 0,
      difference: 0,
    };
    groups.set(shift.cashPointName, {
      count: group.count + 1,
      difference: group.difference + shift.difference,
    });
  }
  return [...groups].map(([cashPointName, group]) => ({
    cashPointName,
    ...group,
  }));
};

/**
 * 日結單(規格第 12 章、6.10;Figma RC-05 `102:23385`):日結(結帳確認申請,類型 = 日結)送出時自動印,
 * 結帳檢視頁可補印。涵蓋計算期間、全店盤點、各收銀點的班數與差額、小金庫應有 / 實點(差額不為 0 才印)、
 * 存入銀行、小金庫留存(= 實點 − 存入銀行);QR 連到結帳確認申請;簽名欄 店長。
 */
export const dailyCloseReceiptOf = (
  input: DailyCloseReceiptInput,
  t: ReceiptTranslator,
): ReceiptLayout => {
  const groups = shiftsByCashPoint(input.shifts);
  const deposit =
    input.bankDepositAmount > 0
      ? t("dailyClose.depositValue", {
          amount: receiptMoney(input.bankDepositAmount),
          account: input.bankAccountName ?? "",
        })
      : t("dailyClose.noDeposit");
  const differenceRow: ReceiptBlock[] =
    input.difference === 0
      ? []
      : [
          {
            type: "row",
            label: t("dailyClose.vaultDifference"),
            value: differenceTextOf(input.difference, input.diffReason, t),
          },
        ];
  return {
    title: t("dailyClose.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: input.submittedAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("dailyClose.period"),
        value: t("range", {
          from: input.periodFrom ?? t("dailyClose.firstClose"),
          to: input.periodTo,
        }),
      },
      {
        type: "row",
        label: t("stocktake.label"),
        value: stocktakeTextOf(input.stocktake, t),
      },
      { type: "divider" },
      {
        type: "table",
        head: [t("cashPoint"), t("dailyClose.columns.shifts"), t("difference")],
        rows: groups.map((group) => [
          group.cashPointName,
          String(group.count),
          receiptSignedMoney(group.difference),
        ]),
      },
      { type: "divider" },
      {
        type: "row",
        label: t("dailyClose.vaultExpected"),
        value: receiptMoney(input.expected),
      },
      {
        type: "row",
        label: t("dailyClose.vaultCounted"),
        value: receiptMoney(input.counted),
      },
      ...differenceRow,
      { type: "row", label: t("dailyClose.bankDeposit"), value: deposit },
      {
        type: "total",
        label: t("dailyClose.vaultAfter"),
        value: receiptMoney(input.counted - input.bankDepositAmount),
      },
      { type: "divider" },
    ],
    qr: { value: input.url, caption: t("qrCaption") },
    signatures: [t("dailyClose.managerSign")],
  };
};

/** 結帳確認申請檢視頁的結帳單(日結)→ 日結單的資料。 */
export const dailyCloseInputOf = (
  detail: CheckoutDetail,
  serialNo: string | null,
  url: string,
  timeText: ReceiptTimeText,
): DailyCloseReceiptInput => ({
  submissionId: detail.submissionId,
  serialNo,
  branchId: detail.orgId,
  periodFrom: detail.coveredFrom == null ? null : timeText(detail.coveredFrom),
  periodTo: timeText(detail.coveredTo ?? detail.submittedAt),
  stocktake: receiptStocktakeOf(detail, timeText),
  shifts: detail.coveredShifts.map((row) => ({
    cashPointName: row.cashPointName,
    difference: row.difference,
  })),
  expected: detail.expected,
  counted: detail.counted,
  difference: detail.difference,
  diffReason: detail.diffReason ?? null,
  bankDepositAmount: detail.bankDepositAmount,
  bankAccountName: detail.bankAccount?.name ?? null,
  submittedAt: detail.submittedAt,
  url,
});
