import { TRANSFER_MODE } from "@repo/domain/project/lottery";
import type { LotteryTransferReceivingFieldsFragment } from "@repo/graphql";

import {
  type ReceiptBlock,
  type ReceiptLayout,
  type ReceiptTranslator,
  bookNumbersOf,
  receiptBookNo,
} from "./receipt-layout";

/** 調貨點收單印兩聯(規格第 12 章、8.4):第 1 聯 收貨店留存、第 2 聯 送貨人留存(文案 `transferReceiving.copies.*`)。 */
export const TRANSFER_RECEIVING_COPIES = ["receiver", "courier"] as const;

export interface TransferReceivingReceiptInput {
  /** 這張調貨單(提交)id:沒有點收批次的舊資料以它計已印次數 */
  submissionId: string;
  serialNo: string | null;
  /** 收貨分店(點收的店):印表機選單、列印紀錄都依它 */
  toBranchId: string;
  fromBranchName: string;
  toBranchName: string;
  /** 依遊戲分組的列(一列 = 一本,或一本的選張),每一列點收了沒 */
  groups: readonly {
    gameCode: string;
    gameName: string;
    rows: readonly {
      rowId: string;
      bookNo: string;
      /** `whole` 整本 / `partial` 選張 */
      mode: string;
      /** 單上這一列的張號 */
      ticketNos: readonly string[];
      tickets: number;
      received: boolean;
      /** 點收紀錄實際搬進來的張號(這一次點收的號碼照它印;還沒點收 = 空) */
      receivedTicketNos: readonly string[];
    }[];
  }[];
  /**
   * 印哪一次點收([完成這次點收] 時給的點收批次;補印照它重排版,和原單一致)。
   * `null` = 這張單還沒有任何點收批次(批次功能上線前點收的舊資料):印到目前為止已點收的全部列
   */
  batch: { batchId: string; no: number; rowIds: readonly string[] } | null;
  /** 這張調貨單在後台的連結(QR code) */
  url: string;
}

type Group = TransferReceivingReceiptInput["groups"][number];
type Row = Group["rows"][number];

const gameText = (group: Group) => `${group.gameCode} ${group.gameName}`;

/**
 * 這一列要印的張號:點收的列照點收紀錄實際搬進來的張(之後逐張點收時一列可能只到部分張);
 * 尚未到的列(或沒有點收紀錄張號的舊資料)照單上的張號。
 */
const ticketNosOf = (row: Row, received: boolean): readonly string[] =>
  received && row.receivedTicketNos.length > 0
    ? row.receivedTicketNos
    : row.ticketNos;

/** 整本、而且(點收的列)整本都到了:寫本號;否則寫張號區段。 */
const isWholeBook = (row: Row, received: boolean): boolean =>
  row.mode === TRANSFER_MODE.whole &&
  (!received ||
    row.receivedTicketNos.length === 0 ||
    row.receivedTicketNos.length >= row.tickets);

/**
 * 每個遊戲一列(遊戲、本數、點收進度)+ 號碼:整本的寫本號區段;選張(或整本只到部分張)的每一列寫
 * 「本號 #張號區段(N 張)」。`progress` = 這一次點收的列(號碼照點收紀錄);否則 = 尚未到的列。沒有列的遊戲不列。
 */
const rowSectionOf = (
  t: ReceiptTranslator,
  picked: readonly { group: Group; rows: readonly Row[] }[],
  progress: boolean,
): ReceiptBlock[] =>
  picked.flatMap(({ group, rows }) => {
    const received = group.rows.filter((row) => row.received).length;
    const whole = rows.filter((row) => isWholeBook(row, progress));
    const partial = rows.filter((row) => !isWholeBook(row, progress));
    const { numbers, digits } = bookNumbersOf(whole.map((row) => row.bookNo));
    return [
      {
        type: "table" as const,
        rows: [
          progress
            ? ([
                gameText(group),
                String(rows.length),
                t("transferReceiving.progress", {
                  received,
                  total: group.rows.length,
                }),
              ] as const)
            : ([gameText(group), String(rows.length)] as const),
        ],
      },
      ...(whole.length === 0
        ? []
        : [
            {
              type: "range" as const,
              label: t("transferReceiving.bookNos"),
              numbers,
              digits,
            },
          ]),
      ...partial.map((row) => {
        const ticketNos = ticketNosOf(row, progress);
        return {
          type: "range" as const,
          label: t("transferReceiving.ticketNos", {
            bookNo: receiptBookNo(row.bookNo),
          }),
          numbers: ticketNos.filter((no) => /^\d+$/.test(no)).map(Number),
          prefix: "#",
          digits: Math.max(0, ...ticketNos.map((no) => no.length)),
          count: t("transferReceiving.ticketCount", {
            count: ticketNos.length,
          }),
        };
      }),
    ];
  });

/**
 * 調貨點收單(規格第 12 章、8.4;版面比照進貨點收單 Figma RC-08,自己的畫面 RC-10 待補):
 * 單號、出貨店 → 收貨店、這次點收的列(遊戲、本數、點收進度、號碼 —— 照點收紀錄實際搬進來的張)、尚未到的列;
 * 簽名欄 點收人、送貨人。
 * 兩聯(`TRANSFER_RECEIVING_COPIES`)的聯別由 `receipt-kinds` 填。
 */
export const transferReceivingReceiptOf = (
  input: TransferReceivingReceiptInput,
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
      ? [{ type: "text", text: t("transferReceiving.noneMissing") }]
      : [
          {
            type: "text",
            text: t("transferReceiving.missing", { count: count(missing) }),
            bold: true,
          },
          ...rowSectionOf(t, missing, false),
        ];

  return {
    title: t("transferReceiving.title"),
    documentNo: t("documentNo", { serialNo: input.serialNo ?? "" }),
    time: printedAt,
    blocks: [
      { type: "divider" },
      {
        type: "row",
        label: t("transferReceiving.route"),
        value: t("transferReceiving.routeValue", {
          from: input.fromBranchName,
          to: input.toBranchName,
        }),
      },
      { type: "divider" },
      {
        type: "text",
        text:
          batch === null
            ? t("transferReceiving.receivedSoFar", { count: count(received) })
            : t("transferReceiving.thisTime", {
                no: batch.no,
                count: count(received),
              }),
        bold: true,
      },
      {
        type: "table",
        head: [
          t("transferReceiving.columns.game"),
          t("transferReceiving.columns.books"),
          t("transferReceiving.columns.progress"),
        ],
        rows: [],
      },
      ...rowSectionOf(t, received, true),
      { type: "divider" },
      ...missingBlocks,
      { type: "divider" },
    ],
    qr: { value: input.url, caption: t("qrCaption") },
    signatures: [
      t("transferReceiving.receiverSign"),
      t("transferReceiving.courierSign"),
    ],
  };
};

/** 點收區塊的資料 → 調貨點收單的資料(列依遊戲分組,順序照單上)。 */
export const transferReceivingInputOf = (
  receiving: LotteryTransferReceivingFieldsFragment,
  document: {
    submissionId: string;
    serialNo: string | null;
    toBranchId: string;
    url: string;
  },
  batch: TransferReceivingReceiptInput["batch"],
): TransferReceivingReceiptInput => {
  const groups = new Map<
    string,
    { gameCode: string; gameName: string; rows: Row[] }
  >();
  for (const row of receiving.rows) {
    const group = groups.get(row.gameCode) ?? {
      gameCode: row.gameCode,
      gameName: row.gameName,
      rows: [],
    };
    group.rows.push({
      rowId: row.rowId,
      bookNo: row.bookNo,
      mode: row.mode,
      ticketNos: row.ticketNos,
      tickets: row.tickets,
      received: row.received,
      receivedTicketNos: row.receivedTicketNos,
    });
    groups.set(row.gameCode, group);
  }
  return {
    ...document,
    fromBranchName: receiving.fromBranchName,
    toBranchName: receiving.toBranchName,
    groups: [...groups.values()],
    batch,
  };
};
