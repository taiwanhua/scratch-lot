import {
  PURCHASE_FIELD_KEYS,
  purchaseHeaderOf,
} from "@repo/domain/project/lottery";
import type {
  FormSubmissionFieldsFragment,
  LotteryPurchaseReceivingFieldsFragment,
} from "@repo/graphql";

import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  bookNumbersOf,
  qrOf,
} from "./receipt-layout";

/** 文案的 namespace(`receipts.purchaseReceiving.*` 與共用的 `receipts.*`)。 */
export const PURCHASING_RECEIPTS_I18N = "admin.lotteryPurchasing.receipts";

/** 進貨點收單印兩聯(規格第 12 章、8.2):第 1 聯 店鋪留存、第 2 聯 送貨人留存(文案 `purchaseReceiving.copies.*`)。 */
export const PURCHASE_RECEIVING_COPIES = ["store", "courier"] as const;

export interface PurchaseReceivingReceiptInput {
  /** 這張進貨單(提交)id:列印紀錄的 `refId` */
  submissionId: string;
  serialNo: string | null;
  /** 進貨分店(印表機選單、列印紀錄都依它) */
  branchId: string;
  branchName: string;
  /** 批購甲類(顯示名) */
  dealerLabel: string | null;
  /** 點收區塊的資料:依遊戲分組,每一本點收了沒 */
  groups: readonly {
    gameCode: string;
    gameName: string;
    rows: readonly { rowId: string; bookNo: string; received: boolean }[];
  }[];
  /**
   * 印哪一次點收([完成這次點收] 時給的點收批次;補印照它重排版,和原單一致)。
   * `null` = 這張單還沒有任何點收批次(批次功能上線前點收的舊資料):印到目前為止已點收的全部本
   */
  batch: { batchId: string; no: number; rowIds: readonly string[] } | null;
  /** 這張單據在後台的連結(QR code) */
  url: string | null;
}

type Group = PurchaseReceivingReceiptInput["groups"][number];
type Row = Group["rows"][number];

const gameText = (group: Group) => `${group.gameCode} ${group.gameName}`;

/** 每個遊戲一列 + 一行本號區段;沒有本的遊戲不列(調貨點收單另有自己的一份:號碼要分整本 / 選張)。 */
const bookSectionOf = (
  t: ReceiptTranslator,
  picked: readonly { group: Group; rows: readonly Row[] }[],
  progress: boolean,
): ReceiptBlock[] =>
  picked.flatMap(({ group, rows }) => {
    const received = group.rows.filter((row) => row.received).length;
    const { numbers, digits } = bookNumbersOf(rows.map((row) => row.bookNo));
    return [
      {
        type: "table" as const,
        rows: [
          progress
            ? ([
                gameText(group),
                String(rows.length),
                t("purchaseReceiving.progress", {
                  received,
                  total: group.rows.length,
                }),
              ] as const)
            : ([gameText(group), String(rows.length)] as const),
        ],
      },
      {
        type: "range" as const,
        label: t("purchaseReceiving.bookNos"),
        numbers,
        digits,
      },
    ];
  });

/**
 * 進貨點收單(規格第 12 章、8.2「進貨點收單」;Figma RC-08 `102:23526`):
 * 單號、進貨分店、甲類、這次點收的本(遊戲、本數、點收進度、本號區段)、尚未到的本;簽名欄 點收人、送貨人。
 * 不記送貨人是誰、不標貨運單號(店長自己寫在單上)。兩聯(`PURCHASE_RECEIVING_COPIES`)的聯別由 `receipt-kinds` 填。
 */
export const purchaseReceivingReceiptOf = (
  input: PurchaseReceivingReceiptInput,
  t: ReceiptTranslator,
  printedAt: string,
): ReceiptLayout => {
  const { batch } = input;
  const session = batch === null ? null : new Set(batch.rowIds);
  const isPicked = (row: Row) =>
    session === null ? row.received : session.has(row.rowId);
  const pick = (test: (row: Row) => boolean) =>
    input.groups
      .map((group) => ({ group, rows: group.rows.filter((row) => test(row)) }))
      .filter(({ rows }) => rows.length > 0);
  const received = pick(isPicked);
  const missing = pick((row) => !row.received);
  const count = (items: typeof received) =>
    items.reduce((sum, item) => sum + item.rows.length, 0);

  const missingBlocks: ReceiptBlock[] =
    missing.length === 0
      ? [{ type: "text", text: t("purchaseReceiving.noneMissing") }]
      : [
          {
            type: "text",
            text: t("purchaseReceiving.missing", { count: count(missing) }),
            bold: true,
          },
          ...bookSectionOf(t, missing, false),
        ];

  return {
    title: t("purchaseReceiving.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: printedAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("purchaseReceiving.branch"),
        value: input.branchName,
      },
      ...(input.dealerLabel === null
        ? []
        : [
            {
              type: "row" as const,
              label: t("purchaseReceiving.dealer"),
              value: input.dealerLabel,
            },
          ]),
      { type: "divider" },
      {
        type: "text",
        text:
          batch === null
            ? t("purchaseReceiving.receivedSoFar", { count: count(received) })
            : t("purchaseReceiving.thisTime", {
                no: batch.no,
                count: count(received),
              }),
        bold: true,
      },
      {
        type: "table",
        head: [
          t("purchaseReceiving.columns.game"),
          t("purchaseReceiving.columns.books"),
          t("purchaseReceiving.columns.progress"),
        ],
        rows: [],
      },
      ...bookSectionOf(t, received, true),
      { type: "divider" },
      ...missingBlocks,
      { type: "divider" },
    ],
    qr: qrOf(input.url, t("qrCaption")),
    signatures: [
      t("purchaseReceiving.receiverSign"),
      t("purchaseReceiving.courierSign"),
    ],
  };
};

/** 表單引用欄的顯示名:`displayValues` 優先,沒有時用存值裡的 `label`(引用的快照)。 */
const displayLabelOf = (
  submission: Pick<FormSubmissionFieldsFragment, "values" | "displayValues">,
  fieldKey: string,
): string | null => {
  const shown = submission.displayValues
    .find((item) => item.fieldKey === fieldKey)
    ?.items.at(0)?.label;
  if (shown !== undefined) {
    return shown;
  }
  const value: unknown = submission.values[fieldKey];
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : null;
};

/** 進貨單(提交)+ 點收區塊的資料 → 進貨點收單的資料。 */
export const purchaseReceivingInputOf = (
  submission: Pick<
    FormSubmissionFieldsFragment,
    "id" | "serialNo" | "values" | "displayValues"
  >,
  receiving: LotteryPurchaseReceivingFieldsFragment,
  batch: PurchaseReceivingReceiptInput["batch"],
  url: string | null,
): PurchaseReceivingReceiptInput => {
  return {
    submissionId: submission.id,
    serialNo: submission.serialNo ?? null,
    branchId: purchaseHeaderOf(submission.values).branchId ?? "",
    branchName: displayLabelOf(submission, PURCHASE_FIELD_KEYS.branch) ?? "",
    dealerLabel: displayLabelOf(submission, PURCHASE_FIELD_KEYS.dealer),
    groups: receiving.groups.map((group) => ({
      gameCode: group.gameCode,
      gameName: group.gameName,
      rows: group.rows.map((row) => ({
        rowId: row.rowId,
        bookNo: row.bookNo,
        received: row.received,
      })),
    })),
    batch,
    url,
  };
};
