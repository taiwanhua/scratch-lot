import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 示範家族三頁會收到的業務錯誤(GQL-04)。文案在 `<ns>.errors.*`,認不出來的一律 `UNEXPECTED`。
 *
 * `FORBIDDEN` 依 `extensions.reason` 再分一層:`FIELD_FORBIDDEN` 是「端點可以用,
 * 但你硬送了一個改不動的欄位」,與「整個端點沒權限」是兩種說法、兩種文案
 * (對照組沒有欄位級權限,所以它永遠不會收到這一碼 —— 共用的解讀器仍然認得它)。
 */
export type DemoErrorCode =
  | "FIELD_FORBIDDEN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "UNEXPECTED";

/**
 * 共用形狀(`lib/base/errors.ts`)。本頁用到的選填欄位只有 `fields`:`VALIDATION_FAILED` 時
 * api 逐項回報的欄位名(`name` / `category` / `coverPath`…),前端據此把錯誤標在對應的
 * 表單欄位上;`FIELD_FORBIDDEN` 時是下方 `FIELD_FORBIDDEN_FIELDS`。
 */
export type DemoError = AdminError<DemoErrorCode, never>;

const DEMO_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
] as const;

/**
 * `FIELD_FORBIDDEN` 時要標在哪個欄位上 —— api 只說「有個欄位你動不得」,不說是哪一個
 * (說了等於洩漏欄位存在)。目前只有示範模組1 的內部備註是欄位級權限欄,所以就標它。
 */
const FIELD_FORBIDDEN_FIELDS = ["internalNote"] as const;

export const demoErrorOf = (error: unknown): DemoError => {
  const parsed = parseAdminError<Exclude<DemoErrorCode, "UNEXPECTED">, never>(
    error,
    {
      codes: DEMO_ERROR_CODES,
      refine: (code, reason) =>
        code === "FORBIDDEN" && reason === "FIELD_FORBIDDEN"
          ? "FIELD_FORBIDDEN"
          : undefined,
    },
  );
  return parsed.code === "FIELD_FORBIDDEN"
    ? { ...parsed, fields: [...FIELD_FORBIDDEN_FIELDS] }
    : parsed;
};

/** 這個欄位上有沒有錯誤(表單把 `helperText` / `error` 標在對的欄位上)。 */
export const hasFieldError = (
  error: DemoError | null,
  field: string,
): boolean => error?.fields?.includes(field) ?? false;
