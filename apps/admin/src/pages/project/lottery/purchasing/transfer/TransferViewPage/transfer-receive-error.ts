import { ClientError } from "@repo/graphql";

/** 調貨點收刷條碼會擋下的原因(api `transfer-error.ts`;文案 `admin.lotteryPurchasing.receive.errors.<reason>`)。 */
export const TRANSFER_RECEIVE_REASONS = [
  "TRANSFER_NOT_RECEIVABLE",
  "TRANSFER_SCAN_INVALID",
  "TRANSFER_ALREADY_RECEIVED",
  "TRANSFER_NOT_SHIPPED",
  "TRANSFER_WRONG_STORE",
  "TRANSFER_BOOK_NOT_ON_TRANSFER",
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
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** 點收的錯誤 → 原因 + (送錯分店時)那張單的資訊;認不得 → `UNEXPECTED`。 */
export const transferReceiveErrorOf = (
  error: unknown,
): TransferReceiveError => {
  if (!(error instanceof ClientError)) {
    return { reason: "UNEXPECTED", wrongStore: null };
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  const extensions = errors?.[0]?.extensions ?? {};
  const reason = TRANSFER_RECEIVE_REASONS.find(
    (item) => item === extensions.reason,
  );
  if (reason === undefined) {
    return { reason: "UNEXPECTED", wrongStore: null };
  }
  return {
    reason,
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
