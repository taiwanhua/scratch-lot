import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  receiptMoney,
} from "./receipt-layout";

export interface SaleRefundReceiptGroup {
  gameCode: string;
  gameName: string;
  /** 3 位張號(排序) */
  ticketNos: readonly string[];
  amount: number;
}

export interface SaleRefundReceiptInput {
  /** 撤銷售出申請的提交 id:列印紀錄的 `refId`,QR 連到檢視頁 */
  submissionId: string;
  serialNo: string | null;
  branchId: string;
  /** 申請還在審核(送出後沒有自動通過)→ 標示「待核准」 */
  pending: boolean;
  /** 印表機:退款班次所屬收銀點的印表機;沒有就用分店預設(規格 5.5) */
  defaultPrinterId?: string | null;
  /** 退款班次(退款從哪一班的抽屜付) */
  refundShiftLabel: string;
  reasonLabel: string;
  groups: readonly SaleRefundReceiptGroup[];
  refundAmount: number;
  url: string;
}

/**
 * 退貨退款收據(規格第 12 章、8.5;Figma RC-09 `102:23571`):撤銷售出申請(退款給客人 = 是)送出時印,
 * 申請還在審核就在單據名稱下標示「待核准」。退款班次、原因、每款遊戲的張數與金額、號碼區段、退款金額;
 * QR 連到那張申請;簽名欄 經手人。`now` = 送出的當下。
 */
export const saleRefundReceiptOf = (
  input: SaleRefundReceiptInput,
  t: ReceiptTranslator,
  now: string,
): ReceiptLayout => ({
  title: t("saleRefund.title"),
  stamp: input.pending ? t("saleRefund.pending") : null,
  documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
  time: now,
  blocks: [
    { type: "divider" },
    {
      type: "row",
      label: t("saleRefund.refundShift"),
      value: input.refundShiftLabel,
    },
    { type: "row", label: t("reason"), value: input.reasonLabel },
    {
      type: "table",
      head: [
        t("saleRefund.columns.game"),
        t("saleRefund.columns.tickets"),
        t("amount"),
      ],
      rows: [],
    },
    ...input.groups.flatMap((group): ReceiptBlock[] => [
      {
        type: "table",
        rows: [
          [
            t("saleRefund.gameValue", {
              gameCode: group.gameCode,
              gameName: group.gameName,
            }),
            String(group.ticketNos.length),
            receiptMoney(group.amount),
          ],
        ],
      },
      {
        type: "range",
        label: t("saleRefund.ticketNos"),
        numbers: group.ticketNos.map(Number),
        prefix: "#",
        digits: 3,
        count: t("saleRefund.ticketCount", { count: group.ticketNos.length }),
      },
    ]),
    {
      type: "total",
      label: t("saleRefund.refund"),
      value: receiptMoney(input.refundAmount),
    },
    { type: "divider" },
  ],
  qr: { value: input.url, caption: t("qrCaption") },
  signatures: [t("handlerSign")],
});
