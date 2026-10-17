/**
 * 設計器工作區的響應式版面(T48;STYLE-03 只用 theme 斷點)。
 *
 * 表單管理頁沿用殼層預設的內容區最小寬度 `lg`(`app/base/module-pages.ts`),所以視窗 1200–1535
 * 時右側面板只有約 520–850px:三欄(元件面板 180 + 畫布 + 屬性面板 360)並排放不下,畫布會被擠到沒寬度。
 *
 * - `xl` 起:三欄並排(元件面板 / 畫布 / 屬性面板),與原本相同
 * - `xl` 以下:工作區換行 —— 元件面板佔滿第一列、裡面的型別按鈕橫向換行;
 *   第二列是畫布 + 收窄的屬性面板,畫布拿剩下的寬度(`flex: 1` + `minWidth: 0`)
 *
 * 只換排列,DOM 順序與操作(點擊新增、拖進畫布)不變。寬度值是設計器一次性的版面尺寸(STYLE-06)。
 */

/** 元件面板在三欄版面的寬度。 */
const PALETTE_WIDTH = 180;
/** 屬性面板寬度:三欄版面 360;`xl` 以下收窄,讓畫布在 1280 寬仍有約 280px。 */
const PROPERTY_PANEL_WIDTH = { xs: 300, xl: 360 } as const;

/** 工作區(元件面板 / 畫布 / 屬性面板的父層 Stack)。 */
export const workspaceSx = {
  alignItems: "flex-start",
  flexWrap: { xs: "wrap", xl: "nowrap" },
} as const;

/** 元件面板的排列方向(給 `Stack` 的 `direction`):`xl` 以下橫排。 */
export const paletteDirection = { xs: "row", xl: "column" } as const;

/** 元件面板:`xl` 以下佔滿一列、按鈕換行。 */
export const paletteSx = {
  width: { xs: "100%", xl: PALETTE_WIDTH },
  flexShrink: 0,
  flexWrap: { xs: "wrap", xl: "nowrap" },
  alignItems: { xs: "center", xl: "stretch" },
} as const;

/** 屬性面板。 */
export const propertyPanelSx = {
  width: PROPERTY_PANEL_WIDTH,
  flexShrink: 0,
} as const;
