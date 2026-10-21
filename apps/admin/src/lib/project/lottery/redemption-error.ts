import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 兌獎會收到的業務錯誤(GQL-04;正本 `docs/modules/project/store.md`「錯誤碼」)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 再細分;文案在 `admin.lotteryStore.redemption.errors.<code>`。
 */
export type RedemptionErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "REDEMPTION_CODE_INVALID"
  | "REDEMPTION_CODE_NEEDS_BACK"
  | "REDEMPTION_OVER_LIMIT"
  | "AMOUNT_EXCEEDS_DRAWER"
  | "REDEMPTION_DUPLICATE"
  | "SHIFT_CLOSED"
  | "REDEMPTION_SENT"
  | "REDEMPTION_ALREADY_REVOKED"
  | "UNEXPECTED";

export type RedemptionError = AdminError<RedemptionErrorCode, never>;

const CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"] as const;

const REASON_CODES: readonly RedemptionErrorCode[] = [
  "REDEMPTION_CODE_INVALID",
  "REDEMPTION_CODE_NEEDS_BACK",
  "REDEMPTION_OVER_LIMIT",
  "AMOUNT_EXCEEDS_DRAWER",
  "REDEMPTION_DUPLICATE",
  "SHIFT_CLOSED",
  "REDEMPTION_SENT",
  "REDEMPTION_ALREADY_REVOKED",
];

export const redemptionErrorOf = (error: unknown): RedemptionError =>
  parseAdminError<Exclude<RedemptionErrorCode, "UNEXPECTED">, never>(error, {
    codes: CODES,
    refine: (code, reason) =>
      code === "VALIDATION_FAILED" &&
      typeof reason === "string" &&
      (REASON_CODES as readonly string[]).includes(reason)
        ? (reason as Exclude<RedemptionErrorCode, "UNEXPECTED">)
        : undefined,
  });

/** 錯誤畫面要用的附帶資料:已兌過的時間與收銀點、抽屜目前的應有。 */
export interface RedemptionErrorDetail {
  redeemedAt?: string;
  cashPointName?: string;
  expected?: number;
}

/** 第一個錯誤的附帶資料(`extensions` 上 api 多帶的欄位)。 */
export const redemptionErrorDetailOf = (
  error: unknown,
): RedemptionErrorDetail => {
  if (!(error instanceof ClientError)) {
    return {};
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  const extensions = errors?.[0]?.extensions ?? {};
  return {
    ...(typeof extensions.redeemedAt === "string" && {
      redeemedAt: extensions.redeemedAt,
    }),
    ...(typeof extensions.cashPointName === "string" && {
      cashPointName: extensions.cashPointName,
    }),
    ...(typeof extensions.expected === "number" && {
      expected: extensions.expected,
    }),
  };
};
