import { ClientError } from "@repo/graphql";

import { type AdminError, parseAdminError } from "@/lib/base/errors";

/**
 * 「匯出專案設定」(表單與流程版本面板共用;`exportFormSeed` / `exportWorkflowSeed`)的錯誤解讀與下載。
 * 兩支端點的錯誤外框相同(正本 docs/modules/forms.md、docs/modules/workflows.md「匯出專案設定」),
 * 所以只有一份;文案在 `admin.seedExport.errors.<code>`,認不出來的一律 `UNEXPECTED`。
 */

/** 使用者在彈窗填的兩欄。 */
export interface SeedExportInput {
  revision: string;
  changelog: string;
}

/** 端點回的檔案:檔名由 api 決定(`<key>.<revision>.seed.ts`),內容是 TypeScript 原始碼。 */
export interface SeedExportFile {
  fileName: string;
  source: string;
}

export const SEED_EXPORT_ERROR_CODES = [
  "FORBIDDEN",
  "ROOT_ONLY",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "VERSION_NOT_PUBLISHED",
  "NOT_PORTABLE",
] as const;

export type SeedExportErrorCode =
  (typeof SEED_EXPORT_ERROR_CODES)[number] | "UNEXPECTED";

/** 不能匯出的一個原因(`VALIDATION_FAILED` + `fields: ["definition"]` 的 `extensions.issues`)。 */
export interface SeedExportIssue {
  code: string;
  /** api 給的修正說明(繁中,給設計者看) */
  message: string;
  /** 設定裡的位置(如 `definition.fields.3.default.value`) */
  path: string;
}

export interface SeedExportError extends AdminError<SeedExportErrorCode> {
  issues?: SeedExportIssue[];
}

/** 通用碼 + reason → 要分開講的碼。 */
const REFINED: Partial<
  Record<string, Partial<Record<string, SeedExportErrorCode>>>
> = {
  FORBIDDEN: { ROOT_ONLY: "ROOT_ONLY" },
};

const isIssue = (value: unknown): value is SeedExportIssue =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SeedExportIssue).message === "string" &&
  typeof (value as SeedExportIssue).path === "string";

const issuesOf = (error: unknown): SeedExportIssue[] => {
  if (!(error instanceof ClientError)) {
    return [];
  }
  const { errors } = error.response as {
    errors?: { extensions?: { issues?: unknown } }[];
  };
  const issues = errors?.[0]?.extensions?.issues;
  return Array.isArray(issues) ? issues.filter((item) => isIssue(item)) : [];
};

/** `VALIDATION_FAILED` 依 api 指出的欄位再分:整份設定不可攜、指名的版本不是已發布、或輸入格式不符。 */
const validationCodeOf = (fields: readonly string[]): SeedExportErrorCode => {
  if (fields.includes("definition")) {
    return "NOT_PORTABLE";
  }
  return fields.includes("version")
    ? "VERSION_NOT_PUBLISHED"
    : "VALIDATION_FAILED";
};

export const seedExportErrorOf = (error: unknown): SeedExportError => {
  const parsed = parseAdminError<
    Exclude<SeedExportErrorCode, "UNEXPECTED">,
    string
  >(error, {
    codes: SEED_EXPORT_ERROR_CODES,
    refine: (code, reason) =>
      typeof reason === "string"
        ? (REFINED[code]?.[reason] as
            Exclude<SeedExportErrorCode, "UNEXPECTED"> | undefined)
        : undefined,
  });
  if (parsed.code !== "VALIDATION_FAILED") {
    return parsed;
  }
  const issues = issuesOf(error);
  return {
    ...parsed,
    code: validationCodeOf(parsed.fields ?? []),
    ...(issues.length > 0 && { issues }),
  };
};

/** 把一段文字存成檔案(瀏覽器的下載):內容原樣寫出,不做任何轉換。 */
export const downloadTextFile = ({
  fileName,
  source,
}: SeedExportFile): void => {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
