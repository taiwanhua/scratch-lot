import { ClientError } from "@repo/graphql";

/** 點收刷條碼會擋下的原因(api `purchase-error.ts`;文案 `admin.lotteryPurchasing.receive.errors.<reason>`)。 */
export const RECEIVE_REASONS = [
  "PURCHASE_NOT_RECEIVABLE",
  "PURCHASE_SCAN_INVALID",
  "PURCHASE_SCAN_AMBIGUOUS_GAME",
  "PURCHASE_ALREADY_RECEIVED",
  "PURCHASE_LAST_TICKET_MISMATCH",
  "PURCHASE_WRONG_STORE",
  "PURCHASE_BOOK_NOT_ON_PURCHASE",
  "BOOK_KEY_DUPLICATE",
] as const;

export type ReceiveReason = (typeof RECEIVE_REASONS)[number] | "UNEXPECTED";

/** 送錯分店(PU-11)的資訊:這本屬於哪家店的哪張進貨單。 */
export interface WrongStoreInfo {
  ownerBranchName: string;
  serialNo: string;
  gameName: string;
  unitPrice: number | null;
  bookNo: string;
}

export interface ReceiveError {
  reason: ReceiveReason;
  wrongStore: WrongStoreInfo | null;
  /** 正面的碼對到好幾款遊戲同本號(`PURCHASE_SCAN_AMBIGUOUS_GAME`):要選的遊戲;其他 = 空 */
  gameIds: string[];
}

/** `extensions.gameIds` → 字串陣列(其他型別略過)。 */
export const gameIdsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** 點收的錯誤 → 原因 + (送錯分店時)那張單的資訊;認不得 → `UNEXPECTED`。 */
export const receiveErrorOf = (error: unknown): ReceiveError => {
  if (!(error instanceof ClientError)) {
    return { reason: "UNEXPECTED", wrongStore: null, gameIds: [] };
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  const extensions = errors?.[0]?.extensions ?? {};
  const reason = RECEIVE_REASONS.find((item) => item === extensions.reason);
  if (reason === undefined) {
    return { reason: "UNEXPECTED", wrongStore: null, gameIds: [] };
  }
  return {
    reason,
    gameIds: gameIdsOf(extensions.gameIds),
    wrongStore:
      reason === "PURCHASE_WRONG_STORE"
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
