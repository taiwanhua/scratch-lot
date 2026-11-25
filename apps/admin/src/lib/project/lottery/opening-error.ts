import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 期初建檔頁會收到的業務錯誤(期初建檔規格 3.2;正本 `docs/modules/project/inventory.md`「錯誤碼」)。
 * `VALIDATION_FAILED` / `CONFLICT` 依 `extensions.reason` 再細分;文案在 `admin.lotteryInventory.opening.errors.<code>`。
 */
export type OpeningErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "STORE_OPENING_CLOSED"
  | "BOOK_ON_PURCHASE"
  | "OPENING_PLAN_INVALID"
  | "OPENING_NOT_VOIDABLE"
  | "UNEXPECTED";

const CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
] as const;

const REASON_CODES: readonly OpeningErrorCode[] = [
  "STORE_OPENING_CLOSED",
  "BOOK_ON_PURCHASE",
  "OPENING_PLAN_INVALID",
  "OPENING_NOT_VOIDABLE",
];

export const openingErrorOf = (
  error: unknown,
): AdminError<OpeningErrorCode, never> =>
  parseAdminError<Exclude<OpeningErrorCode, "UNEXPECTED">, never>(error, {
    codes: CODES,
    refine: (_code, reason) =>
      typeof reason === "string" &&
      (REASON_CODES as readonly string[]).includes(reason)
        ? (reason as Exclude<OpeningErrorCode, "UNEXPECTED">)
        : undefined,
  });

/** 第一個錯誤的附帶資料:進貨單單號(`BOOK_ON_PURCHASE`)、計畫不合的原因(`OPENING_PLAN_INVALID`)。 */
export interface OpeningErrorDetail {
  serialNo?: string;
  openingProblem?: string;
}

export const openingErrorDetailOf = (error: unknown): OpeningErrorDetail => {
  if (!(error instanceof ClientError)) {
    return {};
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  const extensions = errors?.[0]?.extensions ?? {};
  return {
    ...(typeof extensions.serialNo === "string" && {
      serialNo: extensions.serialNo,
    }),
    ...(typeof extensions.openingProblem === "string" && {
      openingProblem: extensions.openingProblem,
    }),
  };
};
