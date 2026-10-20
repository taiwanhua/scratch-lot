import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 庫存管理會收到的業務錯誤(GQL-04;正本 `docs/modules/project/inventory.md`「錯誤碼」)。
 * `VALIDATION_FAILED` / `CONFLICT` 依 `extensions.reason` 再細分;文案在 `admin.lotteryInventory.errors.<code>`。
 */
export type InventoryErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "TICKET_ALREADY_PROCESSED"
  | "CROSS_STORE_NOT_ALLOWED"
  | "NO_SKIPPED_TICKETS"
  | "SKIP_COUNT_MISMATCH"
  | "SKIP_UNCHANGED"
  | "TICKET_STATUS_NOT_ALLOWED"
  | "RECOVER_TARGET_NOT_STORE"
  | "UNEXPECTED";

export type InventoryError = AdminError<InventoryErrorCode, never>;

const CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
] as const;

const REASON_CODES: readonly InventoryErrorCode[] = [
  "TICKET_ALREADY_PROCESSED",
  "CROSS_STORE_NOT_ALLOWED",
  "NO_SKIPPED_TICKETS",
  "SKIP_COUNT_MISMATCH",
  "SKIP_UNCHANGED",
  "TICKET_STATUS_NOT_ALLOWED",
  "RECOVER_TARGET_NOT_STORE",
];

export const inventoryErrorOf = (error: unknown): InventoryError =>
  parseAdminError<Exclude<InventoryErrorCode, "UNEXPECTED">, never>(error, {
    codes: CODES,
    refine: (_code, reason) =>
      typeof reason === "string" &&
      (REASON_CODES as readonly string[]).includes(reason)
        ? (reason as Exclude<InventoryErrorCode, "UNEXPECTED">)
        : undefined,
  });
