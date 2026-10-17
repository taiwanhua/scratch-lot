import { type AdminError, parseAdminError } from "./errors";

/** 列印按鈕看的權限(docs/modules/printers.md「模組 key 與權限表」)。 */
export const PRINT_BUTTON_PERMISSIONS = {
  print: "api.printing.print",
  reprint: "api.printing.reprint",
} as const;

/** 列印按鈕會用到的印表機欄位(`printablePrinters` 的一筆)。 */
export interface PrintablePrinter {
  id: string;
  name: string;
  available: boolean;
}

/**
 * 送到哪一台:使用處傳入的預設(專案:收銀點的印表機)→ 分店預設 → 第一台可選的;
 * 指定的那台不在可選清單裡(停用、代理程式停用、不是這家店的)就往下一個退。沒有可選的 → `null`。
 */
export const resolvePrinterId = (
  printers: readonly PrintablePrinter[],
  preferredId: string | null | undefined,
  branchDefaultId: string | null | undefined,
): string | null => {
  const available = printers.filter((printer) => printer.available);
  const pick = (id: string | null | undefined) =>
    available.find((printer) => printer.id === id)?.id;
  return (
    pick(preferredId) ?? pick(branchDefaultId) ?? available.at(0)?.id ?? null
  );
};

/** PNG Blob → base64(`createPrintJob` 的 `image`;不帶 `data:` 前綴)。 */
export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x80_00;
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
};

/** 送出列印時的業務錯誤(GQL-04;docs/modules/printers.md「錯誤」)。 */
export type PrintButtonErrorCode =
  "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "UNEXPECTED";

const PRINT_BUTTON_ERROR_CODES = [
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
] as const;

/** 文案在 `admin.printButton.errors.<code>`;單據轉圖片失敗、網路錯誤一律 `UNEXPECTED`。 */
export const printButtonErrorOf = (
  error: unknown,
): AdminError<PrintButtonErrorCode, never> =>
  parseAdminError<Exclude<PrintButtonErrorCode, "UNEXPECTED">, never>(error, {
    codes: PRINT_BUTTON_ERROR_CODES,
  });
