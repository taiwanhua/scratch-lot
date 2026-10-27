import type { LotteryTransferReceivingFieldsFragment } from "@repo/graphql";

import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  qrOf,
  receiptBookNo,
  receiptMoney,
} from "./receipt-layout";

/** 調貨出貨單印兩聯(規格第 12 章、8.4):第 1 聯 出貨店留存、第 2 聯 送貨人留存(文案 `transferShipment.copies.*`)。 */
export const TRANSFER_SHIPMENT_COPIES = ["shipper", "courier"] as const;

export interface TransferShipmentReceiptInput {
  /** 這張調貨單(提交)id:列印紀錄的 `refId` */
  submissionId: string;
  serialNo: string | null;
  /** 出貨分店:印表機選單依它(出貨店印) */
  fromBranchId: string;
  fromBranchName: string;
  toBranchName: string;
  /** 這次出貨的列(第一關通過時調出的列;手動列印 = 已出貨的列) */
  rows: readonly {
    gameCode: string;
    bookNo: string;
    ticketNos: readonly string[];
    tickets: number;
    amount: number;
  }[];
  /** 調貨金額(批購金額合計) */
  transferAmount: number;
  url: string | null;
}

/**
 * 調貨出貨單(規格第 12 章、8.4;Figma RC-06 `102:23446`):單號、出貨店 → 收貨店、
 * 每一列(遊戲 / 本、張數、金額 + 張號區段與張數)、調貨金額;簽名欄 出貨人、送貨人(收貨店點收時另印調貨點收單)。
 * 兩聯(`TRANSFER_SHIPMENT_COPIES`)的聯別由 `receipt-kinds` 填。
 */
export const transferShipmentReceiptOf = (
  input: TransferShipmentReceiptInput,
  t: ReceiptTranslator,
  printedAt: string,
): ReceiptLayout => {
  const rowBlocks: ReceiptBlock[] = input.rows.flatMap((row) => {
    const digits = Math.max(0, ...row.ticketNos.map((no) => no.length));
    return [
      {
        type: "table" as const,
        rows: [
          [
            t("transferShipment.bookValue", {
              gameCode: row.gameCode,
              bookNo: receiptBookNo(row.bookNo),
            }),
            receiptMoney(row.tickets),
            receiptMoney(row.amount),
          ] as const,
        ],
      },
      {
        type: "range" as const,
        label: t("transferShipment.ticketNos"),
        numbers: row.ticketNos.filter((no) => /^\d+$/.test(no)).map(Number),
        prefix: "#",
        digits,
        count: t("transferShipment.ticketCount", { count: row.tickets }),
      },
    ];
  });

  return {
    title: t("transferShipment.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: printedAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("transferShipment.route"),
        value: t("transferShipment.routeValue", {
          from: input.fromBranchName,
          to: input.toBranchName,
        }),
      },
      { type: "divider" },
      {
        type: "table",
        head: [
          t("transferShipment.columns.book"),
          t("transferShipment.columns.tickets"),
          t("transferShipment.columns.amount"),
        ],
        rows: [],
      },
      ...rowBlocks,
      {
        type: "total",
        label: t("transferShipment.total"),
        value: receiptMoney(input.transferAmount),
      },
      { type: "divider" },
    ],
    qr: qrOf(input.url, t("qrCaption")),
    signatures: [
      t("transferShipment.shipperSign"),
      t("transferShipment.courierSign"),
    ],
  };
};

type ReceivingRow = LotteryTransferReceivingFieldsFragment["rows"][number];

/**
 * 點收區塊的資料 → 調貨出貨單的資料(`rows` = 要印的列:第一關通過時調出的列,或手動列印時已出貨的列)。
 */
export const transferShipmentInputOf = (
  receiving: LotteryTransferReceivingFieldsFragment,
  document: {
    submissionId: string;
    serialNo: string | null;
    fromBranchId: string;
    url: string | null;
  },
  rows: readonly ReceivingRow[],
): TransferShipmentReceiptInput => ({
  ...document,
  fromBranchName: receiving.fromBranchName,
  toBranchName: receiving.toBranchName,
  rows: rows.map((row) => ({
    gameCode: row.gameCode,
    bookNo: row.bookNo,
    ticketNos: row.ticketNos,
    tickets: row.tickets,
    amount: row.amount,
  })),
  transferAmount: receiving.transferAmount,
});
