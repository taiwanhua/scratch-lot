import { formatNumberRanges } from "@repo/ui/receipt58";

import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  bookNumbersOf,
  qrOf,
  receiptMoney,
} from "./receipt-layout";

/** 批售出貨單印兩聯(規格 21.8):第 1 聯 店鋪留存、第 2 聯 客戶留存(文案 `wholesaleShipment.copies.*`)。 */
export const WHOLESALE_SHIPMENT_COPIES = ["store", "customer"] as const;

export interface WholesaleShipmentReceiptInput {
  /** 這張批售單(提交)id:列印紀錄的 `refId` */
  submissionId: string;
  serialNo: string | null;
  /** 出貨分店:印表機選單依它(出貨分店印) */
  fromBranchId: string;
  fromBranchName: string;
  customerName: string;
  /** 出貨時間(核准完成 = 批售事件的時間;ISO 時點);還沒出貨 = null → 印列印當下 */
  shippedAt: string | null;
  /** 明細(一列 = 一整本);不帶原成本與獲利(出貨單不印) */
  rows: readonly {
    gameCode: string;
    bookNo: string;
    /** 這一本的批售金額 */
    amount: number;
  }[];
  /** 批售金額合計 */
  amount: number;
  /** 收款方式(`auto_bank` / `collect_first`;看不懂 = null → 不印這一列) */
  paymentMode: string | null;
  /** 已收淨額 */
  received: number;
  url: string | null;
}

type Row = WholesaleShipmentReceiptInput["rows"][number];

/** 同遊戲的本併成一列(依明細順序第一次出現的位置排);`first` 帶遊戲。 */
const groupsOf = (rows: readonly Row[]): { first: Row; rows: Row[] }[] => {
  const groups = new Map<string, { first: Row; rows: Row[] }>();
  for (const row of rows) {
    const key = row.gameCode;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { first: row, rows: [row] });
    } else {
      group.rows.push(row);
    }
  }
  return [...groups.values()];
};

/**
 * 批售出貨單(規格 21.8;Figma RC-11 `930:64797`):單號、出貨分店 → 批售客戶、出貨時間、
 * 本清單(遊戲 · 本號區段 / 本數 / 批售金額;使用者 11/26 定:不另印每本張數與批購金額率)、批售金額合計、收款方式與已收、QR;
 * 簽名欄 經手人、客戶簽收。**不印原成本與獲利**。兩聯(`WHOLESALE_SHIPMENT_COPIES`)的聯別由 `receipt-kinds` 填。
 */
export const wholesaleShipmentReceiptOf = (
  input: WholesaleShipmentReceiptInput,
  t: ReceiptTranslator,
  printedAt: string,
): ReceiptLayout => {
  const rowBlocks: ReceiptBlock[] = groupsOf(input.rows).flatMap(
    ({ first, rows: group }) => {
      const { numbers, digits } = bookNumbersOf(group.map((row) => row.bookNo));
      return [
        {
          type: "table" as const,
          rows: [
            [
              t("wholesaleShipment.bookValue", {
                gameCode: first.gameCode,
                bookNos: formatNumberRanges(numbers, { digits }),
              }),
              receiptMoney(group.length),
              receiptMoney(group.reduce((sum, row) => sum + row.amount, 0)),
            ] as const,
          ],
        },
      ];
    },
  );
  const modeBlocks: ReceiptBlock[] =
    input.paymentMode === null
      ? []
      : [
          {
            type: "row",
            label: t("wholesaleShipment.paymentMode"),
            value: t(`wholesaleShipment.paymentModes.${input.paymentMode}`),
          },
        ];

  return {
    title: t("wholesaleShipment.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: input.shippedAt ?? printedAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("wholesaleShipment.route"),
        value: t("wholesaleShipment.routeValue", {
          from: input.fromBranchName,
          to: input.customerName,
        }),
      },
      { type: "divider" },
      {
        type: "table",
        head: [
          t("wholesaleShipment.columns.book"),
          t("wholesaleShipment.columns.books"),
          t("wholesaleShipment.columns.amount"),
        ],
        rows: [],
      },
      ...rowBlocks,
      {
        type: "total",
        label: t("wholesaleShipment.total"),
        value: receiptMoney(input.amount),
      },
      ...modeBlocks,
      {
        type: "row",
        label: t("wholesaleShipment.received"),
        value: receiptMoney(input.received),
      },
      { type: "divider" },
    ],
    qr: qrOf(input.url, t("qrCaption")),
    signatures: [
      t("wholesaleShipment.handlerSign"),
      t("wholesaleShipment.customerSign"),
    ],
  };
};

/** 檢視內容(`lotteryWholesaleDetail`)裡出貨單要的欄位。 */
export interface WholesaleShipmentDetail {
  fromBranchName: string;
  customerName: string;
  paymentMode?: string | null;
  amount: number;
  received: number;
  shippedAt?: string | null;
  rows: readonly {
    gameCode: string;
    bookNo: string;
    amount: number;
  }[];
}

/** 檢視內容 → 批售出貨單的資料(檢視頁 [列印] 與核准完成後的自動列印共用)。 */
export const wholesaleShipmentInputOf = (
  detail: WholesaleShipmentDetail,
  document: {
    submissionId: string;
    serialNo: string | null;
    fromBranchId: string;
    url: string | null;
  },
): WholesaleShipmentReceiptInput => ({
  ...document,
  fromBranchName: detail.fromBranchName,
  customerName: detail.customerName,
  shippedAt: detail.shippedAt ?? null,
  rows: detail.rows.map((row) => ({
    gameCode: row.gameCode,
    bookNo: row.bookNo,
    amount: row.amount,
  })),
  amount: detail.amount,
  paymentMode: detail.paymentMode ?? null,
  received: detail.received,
});
