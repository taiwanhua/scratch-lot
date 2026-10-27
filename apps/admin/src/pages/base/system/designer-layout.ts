import { DRAWER_SIDE_WIDTH } from "@repo/ui/drawer";

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
 *
 * **平板寬(`sm` ≤ 視窗 < `lg`,`DESIGNER_TABLET_BELOW`)另一套**:殼層的內容區最小寬度只在 ≥ `lg` 套用,
 * 平板以下內容隨視窗縮放,左清單 320 + 屬性面板 300 會把畫布擠到幾乎沒有。所以平板寬時
 * 左清單自動收起(`DesignerListRail`)、屬性面板改成右側滑出的非遮罩抽屜(`DesignerPropertyPanel`),
 * 抽屜開著時詳情卡片讓出抽屜寬(`designerDrawerReserve`、`useDesignerDrawerStore`);
 * 手機寬(< `sm`)不掛設計器(REACT-17)。
 */

/**
 * 設計器的「平板寬」上界:視窗小於 `lg` 改用收起的清單與屬性抽屜。
 * 與篩選抽屜(`FilterDrawer`:< `lg` 收進右側抽屜)、`FormActions` 黏底(< `lg`)、殼的內容區最小寬度
 * (≥ `lg` 才套用)同一條界線 —— 視窗 ≥ `lg` 時兩欄加屬性面板放得下,以下就放不下。
 */
export const DESIGNER_TABLET_BELOW = "lg" as const;

/** 表單設計器元件面板在三欄版面的寬度(沿用 `ComponentPalette` 原本的 180)。 */
const PALETTE_WIDTH = 180;

/** 設計器屬性面板(表單設計器的欄位 / 表單設定、流程設計器的關卡屬性)。 */
export const designerPropertyPanelSx = {
  width: { xs: 300, xl: 360 },
  flexShrink: 0,
} as const;

/** 平板寬、屬性抽屜開著時,詳情卡片(連同收起的清單)至少留這麼寬(px);放不下時讓抽屜蓋住卡片右邊一部分,不把內容擠到看不見。 */
const DRAWER_MIN_CONTENT_WIDTH = 320;

/**
 * 平板寬、屬性抽屜開著時,詳情卡片的右內距(`padding-right` 的值):整張卡片(標頭、工具列的 [存草稿]、
 * 檢查結果、未存標示、畫布)都縮到抽屜左邊,不用關抽屜也按得到。抽屜貼齊視窗右緣,卡片右邊外面還有內容區的內距,
 * 讓出整個抽屜寬,多出的那一段剛好當作卡片內容與抽屜之間的留白;平常的右內距(3 單位)是下限。
 * `100%` 是卡片所在那一列的寬(padding 的百分比以容器寬為準)。
 * 回 CSS 算式:theme 開了 `cssVariables`,`spacing()` 回的可能是 `var()` 算式,不能當數字相減(同 `shellContentMinWidth`)。
 */
export const designerDrawerReserve = (
  spacing: (units: number) => string,
): string =>
  `max(${spacing(3)}, min(${String(DRAWER_SIDE_WIDTH)}px, 100% - ${String(DRAWER_MIN_CONTENT_WIDTH)}px))`;

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
