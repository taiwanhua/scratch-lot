import type { Workbook, Worksheet } from "exceljs";

/**
 * Excel 產生器(瀏覽器端 exceljs;專案規格 11.4、18.4「Excel 產生器」;正本 `docs/modules/project/reports.md`):
 * 一個工作表 = 欄位 + 列;每個工作表都設 A4、縮放成一頁寬、每頁重複標題列。
 *
 * 另有**分段表格**(`sections`):一個工作表裡排好幾張小表,每段有自己的標題列(深色底)、表頭(淺色底)、
 * 資料列與合計列(粗體),段與段之間空一列;表頭說明列(`notes`)凍結並每頁重複,一段盡量不被分頁切開。
 *
 * 輸出報表把「全部分店合計 + 每家分店」排成工作表清單交進來(`report-registry.ts` 的 `reportSheetsOf`);
 * 出勤紀錄、採購清單這種沒有期間 / 分店的單純表格直接給一個工作表。預覽(`SheetPreview`)吃同一份 `SheetData`,
 * 畫面看到的就是 Excel 裡的內容。
 */

/** 一個儲存格的值;`null` = 空格。 */
export type SheetCell = string | number | null;

/** 一列(依欄位 key 取值;`SHEET_ROW_KEYS` 的鍵是列的設定,不寫進儲存格)。 */
export type SheetRow = Readonly<Record<string, SheetCell>>;

/**
 * 列的設定鍵(放在列物件裡、不在欄位清單,所以不會被當成儲存格寫出):
 * - `emphasis`:`"total"` = 合計列(粗體)
 * - `format`:`"percent"` = 這一列的數字是比率(Excel `0.0%`、預覽「8.0%」)
 */
export const SHEET_ROW_KEYS = {
  emphasis: "_emphasis",
  format: "_format",
} as const;

export interface SheetColumn {
  /** 對應列物件的欄位名 */
  key: string;
  /** 表頭文字(已翻譯) */
  header: string;
  /** 欄寬(Excel 的字元寬);沒給用 exceljs 預設 */
  width?: number;
  /** Excel 數字格式(例 `#,##0`、負數紅字 `#,##0;[Red]-#,##0`);預覽不看它 */
  numFmt?: string;
  /** 數字欄靠右;預覽與 Excel 都照它 */
  align?: "left" | "right";
}

/** 分段表格的一段(一張小表)。 */
export interface SheetSection {
  /** 段的標題(已翻譯;Excel 是深色底的一列) */
  title: string;
  /** 怎麼讀這一段的一句話(已翻譯;預覽顯示在標題下,Excel 不寫) */
  description?: string;
  columns: readonly SheetColumn[];
  rows: readonly SheetRow[];
  /** 表格下方的補充說明(已翻譯;預覽與 Excel 都寫在表格下方) */
  footnotes?: readonly string[];
}

export interface SheetData {
  /** 工作表名稱(已翻譯;寫入時依 Excel 限制整理,見 `sheetNamesOf`) */
  name: string;
  /**
   * 表頭上方的說明列(例:期間、「本店 10/13 未日結」);列印時與標題列一起每頁重複。
   * 分段表格時是名稱 / 期間 / 產出資訊這幾列:第一列粗體、凍結
   */
  notes?: readonly string[];
  /** 單純表格的欄位與列(有 `sections` 時不用,給空陣列) */
  columns: readonly SheetColumn[];
  rows: readonly SheetRow[];
  /** 分段表格:有給就照段寫,`columns` / `rows` 不用 */
  sections?: readonly SheetSection[];
}

export interface BuildWorkbookInput {
  sheets: readonly SheetData[];
}

/** exceljs 的紙張代碼:9 = A4。 */
const PAPER_SIZE_A4 = 9;
const MAX_SHEET_NAME = 31;
const FORBIDDEN_SHEET_NAME_CHARS = /[\\/?*:[\]]/g;
/** A4 直向、一頁寬時一頁大約排得下的列數(估計值;只用來讓一段盡量不跨頁)。 */
export const ROWS_PER_PAGE = 48;
/** 分段表格的顏色(ARGB):段標題深色底白字、表頭淺色底、框線灰。 */
const SECTION_TITLE_FILL = "FF37474F";
const SECTION_TITLE_FONT = "FFFFFFFF";
const HEADER_FILL = "FFE3E8EE";
const BORDER_COLOR = "FFB0BEC5";
const PERCENT_FORMAT = "0.0%";

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

/** 這一列是合計列。 */
export const isTotalRow = (row: SheetRow): boolean =>
  row[SHEET_ROW_KEYS.emphasis] === "total";

/** 這一列的數字是比率。 */
export const isPercentRow = (row: SheetRow): boolean =>
  row[SHEET_ROW_KEYS.format] === "percent";

/** 儲存格的顯示文字(預覽用):數字千分位;比率列 `8.0%`;空格 = 空字串。 */
export const sheetCellText = (
  value: SheetCell | undefined,
  percent = false,
): string => {
  if (value === null || value === undefined) return "";
  if (typeof value !== "number") return value;
  return percent ? `${(value * 100).toFixed(1)}%` : value.toLocaleString();
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

const pageSetupOf = (titleRows: number) => ({
  paperSize: PAPER_SIZE_A4,
  orientation: "portrait" as const,
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  printTitlesRow: `1:${String(Math.max(1, titleRows))}`,
});

const addTableSheet = (
  workbook: Workbook,
  sheet: SheetData,
  name: string,
): void => {
  const notes = sheet.notes ?? [];
  const headerRow = notes.length + 1;
  const worksheet = workbook.addWorksheet(name, {
    pageSetup: pageSetupOf(headerRow),
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

const thinBorder = {
  top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
};

const solidFill = (argb: string) => ({
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb },
});

/** 段的標題列(合併到 `width` 欄、深色底白字)與表頭(淺色底、框線)。 */
const writeSectionHead = (
  worksheet: Worksheet,
  section: SheetSection,
  width: number,
): void => {
  const title = worksheet.addRow([section.title]);
  if (width > 1) {
    worksheet.mergeCells(title.number, 1, title.number, width);
  }
  title.font = { bold: true, color: { argb: SECTION_TITLE_FONT } };
  title.getCell(1).fill = solidFill(SECTION_TITLE_FILL);
  const header = worksheet.addRow(
    section.columns.map((column) => column.header),
  );
  header.font = { bold: true };
  for (const [index, column] of section.columns.entries()) {
    const cell = header.getCell(index + 1);
    cell.fill = solidFill(HEADER_FILL);
    cell.border = thinBorder;
    if (column.align !== undefined) {
      cell.alignment = { horizontal: column.align };
    }
  }
};

/** 段的一列資料:框線、數字格式(比率列用 `0.0%`)、合計列粗體。 */
const writeSectionRow = (
  worksheet: Worksheet,
  columns: readonly SheetColumn[],
  row: SheetRow,
): void => {
  const added = worksheet.addRow(
    columns.map((column) => row[column.key] ?? null),
  );
  if (isTotalRow(row)) {
    added.font = { bold: true };
  }
  const percent = isPercentRow(row);
  for (const [index, column] of columns.entries()) {
    const cell = added.getCell(index + 1);
    cell.border = thinBorder;
    const format = percent ? PERCENT_FORMAT : column.numFmt;
    if (typeof cell.value === "number" && format !== undefined) {
      cell.numFmt = format;
    }
    if (column.align !== undefined) {
      cell.alignment = { horizontal: column.align };
    }
  }
};

/** 一段佔幾列(標題 + 表頭 + 資料 + 補充說明)。 */
const sectionHeight = (section: SheetSection): number =>
  2 + section.rows.length + (section.footnotes?.length ?? 0);

/**
 * 哪幾段前面要換頁:一段放不進這一頁剩下的空間、但一整頁放得下 → 換頁再寫(一段盡量不被切開);
 * 段與段之間空一列。`pageBody` = 一頁扣掉每頁重複的說明列後的列數。
 */
export const sectionPageBreaksOf = (
  heights: readonly number[],
  pageBody: number,
): boolean[] => {
  let used = 0;
  return heights.map((height, index) => {
    const gap = index === 0 ? 0 : 1;
    const breaks =
      used > 0 && used + gap + height > pageBody && height <= pageBody;
    used = ((breaks ? 0 : used + gap) + height) % pageBody;
    return breaks;
  });
};

/** 同一欄位置取各段裡最寬的欄寬。 */
const columnWidthsOf = (sections: readonly SheetSection[]): number[] => {
  const widths: number[] = [];
  for (const section of sections) {
    for (const [index, column] of section.columns.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, column.width ?? 0);
    }
  }
  return widths;
};

const addSectionSheet = (
  workbook: Workbook,
  sheet: SheetData,
  sections: readonly SheetSection[],
  name: string,
): void => {
  const notes = sheet.notes ?? [];
  const worksheet = workbook.addWorksheet(name, {
    pageSetup: pageSetupOf(notes.length),
    views:
      notes.length === 0 ? [] : [{ state: "frozen", ySplit: notes.length }],
  });
  for (const [index, note] of notes.entries()) {
    const row = worksheet.addRow([note]);
    if (index === 0) row.font = { bold: true, size: 14 };
  }
  const width = Math.max(1, ...sections.map((item) => item.columns.length));
  const breaks = sectionPageBreaksOf(
    sections.map((section) => sectionHeight(section)),
    Math.max(1, ROWS_PER_PAGE - notes.length),
  );
  for (const [index, section] of sections.entries()) {
    if (breaks[index]) {
      worksheet.lastRow?.addPageBreak();
    } else if (index > 0) {
      worksheet.addRow([]);
    }
    writeSectionHead(worksheet, section, width);
    for (const row of section.rows) {
      writeSectionRow(worksheet, section.columns, row);
    }
    for (const footnote of section.footnotes ?? []) {
      worksheet.addRow([footnote]).font = { italic: true };
    }
  }
  for (const [index, columnWidth] of columnWidthsOf(sections).entries()) {
    if (columnWidth > 0) worksheet.getColumn(index + 1).width = columnWidth;
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
    const name = names[index] ?? sheet.name;
    if (sheet.sections === undefined) {
      addTableSheet(workbook, sheet, name);
    } else {
      addSectionSheet(workbook, sheet, sheet.sections, name);
    }
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
