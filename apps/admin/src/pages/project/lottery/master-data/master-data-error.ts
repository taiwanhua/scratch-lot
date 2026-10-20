import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 檔案管理會收到的業務錯誤(GQL-04;正本 `docs/modules/project/master-data.md`「錯誤碼」)。
 * `VALIDATION_FAILED` 依 `extensions.reason` 再細分成本頁的碼(文案不同);
 * 文案在 `admin.lotteryMasterData.errors.<code>`。
 */
export type MasterDataErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "GAME_CODE_DUPLICATE"
  | "GAME_IN_USE"
  | "POSITION_DUPLICATE"
  | "NAME_DUPLICATE"
  | "CASH_POINT_IN_USE"
  | "UNEXPECTED";

export type MasterDataError = AdminError<MasterDataErrorCode, never>;

const CODES = ["FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED"] as const;

const REASON_CODES: readonly MasterDataErrorCode[] = [
  "GAME_CODE_DUPLICATE",
  "GAME_IN_USE",
  "POSITION_DUPLICATE",
  "NAME_DUPLICATE",
  "CASH_POINT_IN_USE",
];

export const masterDataErrorOf = (error: unknown): MasterDataError =>
  parseAdminError<Exclude<MasterDataErrorCode, "UNEXPECTED">, never>(error, {
    codes: CODES,
    refine: (code, reason) =>
      code === "VALIDATION_FAILED" &&
      typeof reason === "string" &&
      (REASON_CODES as readonly string[]).includes(reason)
        ? (reason as Exclude<MasterDataErrorCode, "UNEXPECTED">)
        : undefined,
  });
