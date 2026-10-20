import type { Workbook } from "exceljs";

/**
 * Excel 產生器(瀏覽器端 exceljs;專案規格 11.4、18.4「Excel 產生器」;正本 `docs/modules/project/reports.md`):
 * 一個工作表 = 欄位 + 列;每個工作表都設 A4、縮放成一頁寬、每頁重複標題列。
 *
 * 輸出報表把「全部分店合計 + 每家分店」排成工作表清單交進來(`report-registry.ts` 的 `reportSheetsOf`);
 * 出勤紀錄、採購清單這種沒有期間 / 分店的單純表格直接給一個工作表。預覽(`SheetPreview`)吃同一份 `SheetData`,
 * 畫面看到的就是 Excel 裡的內容。
 */

/** 一個儲存格的值;`null` = 空格。 */
export type SheetCell = string | number | null;

export interface SheetColumn {
  /** 對應列物件的欄位名 */
  key: string;
  /** 表頭文字(已翻譯) */
  header: string;
  /** 欄寬(Excel 的字元寬);沒給用 exceljs 預設 */
  width?: number;
  /** Excel 數字格式(例 `#,##0`);預覽不看它 */
  numFmt?: string;
  /** 數字欄靠右;預覽與 Excel 都照它 */
  align?: "left" | "right";
}

export interface SheetData {
  /** 工作表名稱(已翻譯;寫入時依 Excel 限制整理,見 `sheetNamesOf`) */
  name: string;
  /** 表頭上方的說明列(例:期間、「本店 10/13 未日結」);列印時與標題列一起每頁重複 */
  notes?: readonly string[];
  columns: readonly SheetColumn[];
  rows: readonly Readonly<Record<string, SheetCell>>[];
}

export interface BuildWorkbookInput {
  sheets: readonly SheetData[];
}

/** exceljs 的紙張代碼:9 = A4。 */
const PAPER_SIZE_A4 = 9;
const MAX_SHEET_NAME = 31;
const FORBIDDEN_SHEET_NAME_CHARS = /[\\/?*:[\]]/g;

/**
 * Excel 工作表名稱的限制:不能有 `\ / ? * : [ ]`、最多 31 字、同一本不能重名(不分大小寫)。
 * 不合的就整理:去掉禁用字元、截斷、重名加「 (2)」;整理完是空的給 `Sheet<序號>`。
 */
export const sheetNamesOf = (names: readonly string[]): string[] => {
  const used = new Set<string>();
  return names.map((raw, index) => {
    const cleaned = raw
      .replaceAll(FORBIDDEN_SHEET_NAME_CHARS, "")
      .trim()
      .slice(0, MAX_SHEET_NAME);
    const base = cleaned === "" ? `Sheet${String(index + 1)}` : cleaned;
    let name = base;
    let copy = 1;
    while (used.has(name.toLowerCase())) {
      copy += 1;
      const suffix = ` (${String(copy)})`;
      name = `${base.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
};

type ExcelModule = typeof import("exceljs");

/**
 * exceljs 很大(約 1 MB),只在真的要產 Excel 時才載入(動態 import,打包成獨立的 chunk)。
 * 它是 CommonJS 套件:打包後(Vite)是具名匯出、jest 的 ESM 環境是 `default`,兩種都接。
 */
const loadExcel = async (): Promise<ExcelModule> => {
  const loaded = await import("exceljs");
  return (loaded as ExcelModule & { default?: ExcelModule }).default ?? loaded;
};

const addSheet = (workbook: Workbook, sheet: SheetData, name: string): void => {
  const notes = sheet.notes ?? [];
  const headerRow = notes.length + 1;
  const worksheet = workbook.addWorksheet(name, {
    pageSetup: {
      paperSize: PAPER_SIZE_A4,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `1:${String(headerRow)}`,
    },
  });
  for (const note of notes) {
    worksheet.addRow([note]);
  }
  const header = worksheet.addRow(sheet.columns.map((column) => column.header));
  header.font = { bold: true };
  for (const row of sheet.rows) {
    worksheet.addRow(sheet.columns.map((column) => row[column.key] ?? null));
  }
  for (const [index, column] of sheet.columns.entries()) {
    const target = worksheet.getColumn(index + 1);
    if (column.width !== undefined) target.width = column.width;
    if (column.numFmt !== undefined) {
      target.eachCell((cell, rowNumber) => {
        if (rowNumber > headerRow) cell.numFmt = column.numFmt ?? "";
      });
    }
    if (column.align !== undefined) {
      target.alignment = { horizontal: column.align };
    }
  }
};

/** 工作表清單 → 活頁簿(順序照傳入)。 */
export const buildWorkbook = async ({
  sheets,
}: BuildWorkbookInput): Promise<Workbook> => {
  const excel = await loadExcel();
  const workbook = new excel.Workbook();
  const names = sheetNamesOf(sheets.map((sheet) => sheet.name));
  for (const [index, sheet] of sheets.entries()) {
    addSheet(workbook, sheet, names[index] ?? sheet.name);
  }
  return workbook;
};

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 把工作表存成 `.xlsx`(瀏覽器的下載;做法同 `lib/base/seed-export.ts` 的 `downloadTextFile`)。 */
export const downloadWorkbook = async ({
  sheets,
  fileName,
}: BuildWorkbookInput & { fileName: string }): Promise<void> => {
  const workbook = await buildWorkbook({ sheets });
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_MIME }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
