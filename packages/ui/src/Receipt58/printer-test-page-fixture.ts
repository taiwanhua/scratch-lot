import type { PrinterTestPageLabels } from "./PrinterTestPage";

/**
 * 測試頁的繁中示範文字,給 story 與測試用。
 * 正式使用處的文字來自 admin 的訊息檔(I18N-01),不從這裡取。
 */
export const printerTestPageLabels = {
  title: "測試頁",
  large: "大字 ABC 123",
  normal: "一般字 ABC 123",
  small: "小字 ABC 123",
  bold: "粗體字 ABC 123",
  alignLeft: "靠左",
  alignCenter: "置中",
  alignRight: "靠右",
  rowLabel: "左欄",
  rowValue: "右欄",
  tableHead: ["品項", "數量", "金額"],
  tableRow: ["示範品項", "2", "400"],
  longText:
    "長文字換行:這一行故意寫得很長,用來確認超過一行約 16 個中文字時會自動換到下一行,不會被截斷。",
  qrCaption: "掃描開啟印表機管理",
  cut: "切紙",
} satisfies PrinterTestPageLabels;
