import { ClientError } from "@repo/graphql";

import { parseAdminError } from "@/lib/base/errors";

/**
 * 銷售、當下撤銷、拆本、移櫃的業務錯誤(GQL-04;正本 `docs/modules/project/store.md`「錯誤碼」)。
 * `extensions.reason` 細分;不是這幾種 → `code: null`(改用店面管理共用的 `storeErrorKey`)。
 */
export const STORE_SALES_ERROR_CODES = [
  "LOCAL_SHIFT_NOT_OPEN",
  "TICKET_NOT_SELLABLE",
  "ALREADY_SOLD",
  "MOVE_CONFIRM_REQUIRED",
  "MOVE_NOT_ALLOWED",
  "UNDO_NOT_ALLOWED",
  "BOOK_ALREADY_OPENED",
  "SPLIT_PLAN_INVALID",
  "TICKET_NOT_ON_COUNTER",
  "GAME_NOT_FOUND",
  "COUNT_SALE_NOT_ALLOWED",
  "COUNT_SALE_INVALID",
  "COUNT_SALE_NOT_FOUND",
  "COUNT_UNDO_EXCEEDS",
  "COUNT_STORE_SCAN_ONLY",
  "COUNTER_TICKET_BLOCKED",
  "MOVE_PAUSED",
  "MOVE_BY_COUNT_INVALID",
  "SPLIT_ACTUAL_COUNT_REQUIRED",
  "SPLIT_ACTUAL_COUNT_MISMATCH",
  "CONFLICT",
] as const;

export type StoreSalesErrorCode = (typeof STORE_SALES_ERROR_CODES)[number];

export interface StoreSalesError {
  code: StoreSalesErrorCode | null;
  /** `ALREADY_SOLD`:什麼時候賣的 */
  soldAt: string | null;
  /** `COUNT_SALE_INVALID` / `COUNT_UNDO_EXCEEDS` / `MOVE_BY_COUNT_INVALID`:還有幾張 */
  available: number | null;
  /** `MOVE_BY_COUNT_INVALID` / `SPLIT_ACTUAL_COUNT_MISMATCH`:細分的問題 */
  problem: string | null;
  /** `SPLIT_ACTUAL_COUNT_MISMATCH`:多 / 少幾張 */
  count: number | null;
  /** `MOVE_PAUSED`:全店重刷(`rescan`)/ 補點編號(`renumber`) */
  pauseKind: string | null;
}

const extensionsOf = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof ClientError)) {
    return {};
  }
  const { errors } = error.response as {
    errors?: { extensions?: Record<string, unknown> }[];
  };
  return errors?.[0]?.extensions ?? {};
};

/** 讀出銷售類的錯誤碼與附帶的售出時間。 */
export const storeSalesErrorOf = (error: unknown): StoreSalesError => {
  const parsed = parseAdminError<StoreSalesErrorCode, never>(error, {
    codes: ["CONFLICT"],
    refine: (_code, reason) =>
      typeof reason === "string" &&
      (STORE_SALES_ERROR_CODES as readonly string[]).includes(reason)
        ? (reason as StoreSalesErrorCode)
        : undefined,
  });
  const { soldAt, available, problem, count, pause } = extensionsOf(error);
  const pauseKind =
    typeof pause === "object" && pause !== null && "kind" in pause
      ? pause.kind
      : null;
  return {
    code: parsed.code === "UNEXPECTED" ? null : parsed.code,
    soldAt: typeof soldAt === "string" ? soldAt : null,
    available: typeof available === "number" ? available : null,
    problem: typeof problem === "string" ? problem : null,
    count: typeof count === "number" ? count : null,
    pauseKind: typeof pauseKind === "string" ? pauseKind : null,
  };
};
