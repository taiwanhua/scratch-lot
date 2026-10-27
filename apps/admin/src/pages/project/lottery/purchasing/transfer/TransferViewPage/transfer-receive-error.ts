import { ClientError } from "@repo/graphql";

import { gameIdsOf } from "../../purchase/PurchaseViewPage/receive-error";

/** 調貨點收刷條碼會擋下的原因(api `transfer-error.ts`;文案 `admin.lotteryPurchasing.receive.errors.<reason>`)。 */
export const TRANSFER_RECEIVE_REASONS = [
  "TRANSFER_NOT_RECEIVABLE",
  "TRANSFER_SCAN_INVALID",
  "TRANSFER_SCAN_AMBIGUOUS_GAME",
  "TRANSFER_ALREADY_RECEIVED",
  "TRANSFER_NOT_SHIPPED",
  "TRANSFER_WRONG_STORE",
  "TRANSFER_BOOK_NOT_ON_TRANSFER",
  "TRANSFER_WHOLE_ROW_TICKETS",
] as const;

export type TransferReceiveReason =
  (typeof TRANSFER_RECEIVE_REASONS)[number] | "UNEXPECTED";

/** 送錯分店的資訊:這本屬於送往哪家店的哪張調貨單。 */
export interface TransferWrongStoreInfo {
  ownerBranchName: string;
  serialNo: string;
  gameName: string;
  unitPrice: number | null;
  bookNo: string;
}

export interface TransferReceiveError {
  reason: TransferReceiveReason;
  wrongStore: TransferWrongStoreInfo | null;
  /** 正面的碼對到好幾款遊戲同本號(`TRANSFER_SCAN_AMBIGUOUS_GAME`):要選的遊戲;其他 = 空 */
  gameIds: string[];
  /** 選張的列這幾張已點收(`TRANSFER_ALREADY_RECEIVED`);整列已點收 / 其他 = 空 */
  ticketNos: string[];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** 點收的錯誤 → 原因 + (送錯分店時)那張單的資訊;認不得 → `UNEXPECTED`。 */
export const transferReceiveErrorOf = (
  error: unknown,
): TransferReceiveError => {
  if (!(error instanceof ClientError)) {
    return {
      reason: "UNEXPECTED",
      wrongStore: null,
      gameIds: [],
      ticketNos: [],
    };
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  const extensions = errors?.[0]?.extensions ?? {};
  const reason = TRANSFER_RECEIVE_REASONS.find(
    (item) => item === extensions.reason,
  );
  if (reason === undefined) {
    return {
      reason: "UNEXPECTED",
      wrongStore: null,
      gameIds: [],
      ticketNos: [],
    };
  }
  return {
    reason,
    gameIds: gameIdsOf(extensions.gameIds),
    ticketNos: gameIdsOf(extensions.ticketNos),
    wrongStore:
      reason === "TRANSFER_WRONG_STORE"
        ? {
            ownerBranchName: text(extensions.ownerBranchName),
            serialNo: text(extensions.serialNo),
            gameName: text(extensions.gameName),
            unitPrice:
              typeof extensions.unitPrice === "number"
                ? extensions.unitPrice
                : null,
            bookNo: text(extensions.bookNo),
          }
        : null,
  };
};
