import { describe, expect, it } from "@jest/globals";

import { type SheetData, buildWorkbook, sheetNamesOf } from "./excel";

/** 寫成 xlsx 再讀回來(斷言的是檔案裡真的有的設定,不是記憶體物件)。 */
const roundTrip = async (sheets: readonly SheetData[]) => {
  const workbook = await buildWorkbook({ sheets });
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new (workbook.constructor as new () => typeof workbook)();
  await loaded.xlsx.load(buffer);
  return loaded;
};

/** 讀回後的第一個工作表。 */
const firstSheetOf = async (sheets: readonly SheetData[]) => {
  const workbook = await roundTrip(sheets);
  const worksheet = workbook.worksheets.at(0);
  if (worksheet === undefined) throw new Error("no worksheet");
  return worksheet;
};

const columns = [
  { key: "item", header: "項目", width: 20 },
  { key: "amount", header: "金額", numFmt: "#,##0" },
] as const;

const sheet = (name: string, amount: number): SheetData => ({
  name,
  columns,
  rows: [
    { item: "淨銷售", amount },
    { item: "備註", amount: null },
  ],
});

describe("buildWorkbook", () => {
  it("2 家分店 + 合計 → 3 個工作表,順序照傳入", async () => {
    const workbook = await roundTrip([
      sheet("全部分店合計", 300),
      sheet("中山店", 100),
      sheet("新竹店", 200),
    ]);
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "全部分店合計",
      "中山店",
      "新竹店",
    ]);
  });

  it("每個工作表:A4、縮放成一頁寬、每頁重複標題列", async () => {
    const workbook = await roundTrip([
      sheet("全部分店合計", 300),
      sheet("中山店", 100),
    ]);
    for (const worksheet of workbook.worksheets) {
      expect(worksheet.pageSetup).toMatchObject({
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "1:1",
      });
    }
  });

  it("表頭在第 1 列、資料從第 2 列;數字保持數字,null 是空格", async () => {
    const worksheet = await firstSheetOf([sheet("中山店", 1234)]);
    expect(worksheet.getRow(1).values).toEqual([undefined, "項目", "金額"]);
    expect(worksheet.getCell("A2").value).toBe("淨銷售");
    expect(worksheet.getCell("B2").value).toBe(1234);
    expect(worksheet.getCell("B2").numFmt).toBe("#,##0");
    expect(worksheet.getCell("B3").value).toBeNull();
    expect(worksheet.getColumn(1).width).toBe(20);
  });

  it("有表頭說明(notes)時:說明在上、標題列往下推,重複列含說明到標題列", async () => {
    const worksheet = await firstSheetOf([
      {
        ...sheet("全部分店合計", 300),
        notes: ["營運報表 2026-10-16", "新竹店 10/16 未日結"],
      },
    ]);
    expect(worksheet.getCell("A1").value).toBe("營運報表 2026-10-16");
    expect(worksheet.getCell("A2").value).toBe("新竹店 10/16 未日結");
    expect(worksheet.getRow(3).values).toEqual([undefined, "項目", "金額"]);
    expect(worksheet.pageSetup.printTitlesRow).toBe("1:3");
  });

  it("沒有期間 / 分店的單純表格也能產(出勤紀錄、採購清單)", async () => {
    const workbook = await roundTrip([
      {
        name: "採購清單",
        columns: [{ key: "game", header: "遊戲" }],
        rows: [],
      },
    ]);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0]?.getRow(1).values).toEqual([
      undefined,
      "遊戲",
    ]);
  });
});

describe("sheetNamesOf(Excel 工作表名稱的限制)", () => {
  it("去掉不能用的字元、截到 31 字、重名加序號、空白給預設名", () => {
    expect(
      sheetNamesOf([
        "中山店",
        "中山店",
        String.raw`A/B:C*D?E[F]G\H`,
        "一".repeat(40),
        "  ",
      ]),
    ).toEqual(["中山店", "中山店 (2)", "ABCDEFGH", "一".repeat(31), "Sheet5"]);
  });
});
