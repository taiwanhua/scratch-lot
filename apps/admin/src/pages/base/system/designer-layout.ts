/**
 * 兩個設計器頁(表單管理、流程管理)共用的響應式版面(STYLE-03 只用 theme 斷點)。
 *
 * 兩頁都沿用殼層預設的內容區最小寬度 `lg`(`app/base/module-pages.ts` 不另宣告 `xl`),
 * 所以視窗 1200–1535 時右側詳情卡片只有約 520–850px。設計器在 `xl` 以下自己換版,
 * 只換排列,DOM 順序與操作(點擊、拖拉、選取)不變:
 *
 * - 屬性面板:`xl` 起 360;以下收窄為 300,讓畫布在 1280 寬仍有約 280px
 * - 表單設計器的元件面板:`xl` 起是左欄(180);以下佔滿工作區第一列、型別按鈕橫向換行,
 *   第二列是畫布 + 屬性面板(工作區 `flexWrap`)
 * - 詳情卡片標頭:操作鈕自成一組;`xl` 以下標題欄以內容寬為底,放不下時操作鈕整組換到下一列,不把標題擠扁
 *
 * 寬度值是設計器一次性的版面尺寸(STYLE-06),集中在這裡。
 * 視窗比 `lg` 還窄(如 1024)時依殼層規則由 `<main>` 水平捲動(`docs/concepts/frontend-architecture.md`)。
 */

/** 表單設計器元件面板在三欄版面的寬度(沿用 `ComponentPalette` 原本的 180)。 */
const PALETTE_WIDTH = 180;

/** 設計器屬性面板(表單設計器的欄位 / 表單設定、流程設計器的關卡屬性)。 */
export const designerPropertyPanelSx = {
  width: { xs: 300, xl: 360 },
  flexShrink: 0,
} as const;

/** 表單設計器工作區(元件面板 / 畫布 / 屬性面板的父層 Stack):`xl` 以下換行。 */
export const designerWorkspaceSx = {
  alignItems: "flex-start",
  flexWrap: { xs: "wrap", xl: "nowrap" },
} as const;

/** 表單設計器元件面板的排列方向(給 `Stack` 的 `direction`):`xl` 以下橫排。 */
export const designerPaletteDirection = { xs: "row", xl: "column" } as const;

/** 表單設計器元件面板:`xl` 以下佔滿一列、按鈕換行。 */
export const designerPaletteSx = {
  width: { xs: "100%", xl: PALETTE_WIDTH },
  flexShrink: 0,
  flexWrap: { xs: "wrap", xl: "nowrap" },
  alignItems: { xs: "center", xl: "stretch" },
} as const;

/**
 * 詳情卡片標頭的標題欄:`xl` 以下以內容寬為底(`flex-basis: auto`),放不下時操作鈕整組換行、不把標題擠扁;
 * `xl` 起維持原本的 `flex: 1`(basis 0),與改成響應式之前相同。
 */
export const detailHeaderTitleSx = {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: { xs: "auto", xl: 0 },
  minWidth: 0,
} as const;

/** 詳情卡片標頭的操作鈕組(給 `Stack direction="row"`):整組可換行。 */
export const detailHeaderActionsSx = {
  flexWrap: "wrap",
  alignItems: "center",
} as const;
