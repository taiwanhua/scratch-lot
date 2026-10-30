import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 輸出報表的錯誤解讀(DATA-06;碼沿用 GQL-04 的通用碼):
 * `VALIDATION_FAILED` + `reason: "RANGE_TOO_LARGE"`(api `assertReportRange`)細分成 `RANGE_TOO_LARGE`。
 * 文案在 `admin.reports.errors.<code>`。
 */
const CODES = ["RANGE_TOO_LARGE", "VALIDATION_FAILED", "FORBIDDEN"] as const;

export type ReportsErrorCode = (typeof CODES)[number] | "UNEXPECTED";

export const reportsErrorOf = (error: unknown): AdminError<ReportsErrorCode> =>
  parseAdminError(error, {
    codes: CODES,
    refine: (code, reason) =>
      code === "VALIDATION_FAILED" && reason === "RANGE_TOO_LARGE"
        ? "RANGE_TOO_LARGE"
        : undefined,
  });
