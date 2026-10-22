import { useBreakpointDown } from "@repo/ui/media-query";

/**
 * 殼的幾何(theme.spacing 單位;`SideNav` 與 `ShellLayout` 共用,改一處兩邊一起變)。
 *
 * - 側欄寬:Figma AdminSideNav 240 寬、AdminSideNavCollapsed 246:64 為 64 寬
 * - 內容區(`<main>`)四邊內距:手機寬(< `sm`)8px 留給內容,其餘 24px
 * - 精簡版界線:< `md` 頂部列精簡 + 側欄改抽屜(`SHELL_COMPACT_BELOW`)
 */
export const NAV_WIDTH = 30;
export const NAV_COLLAPSED_WIDTH = 8;
export const MAIN_PADDING = { xs: 1, sm: 3 } as const;

/**
 * 殼的精簡版界線(主題斷點,沿用 MUI 預設 sm 600 / md 900 / lg 1200,不另設斷點):視窗**小於** `md`(手機與直拿平板)時
 * 頂部列只留主選單鈕、頁名、通知鈴與精簡版組織切換,側欄改成抽屜,說明「?」與頭像選單在抽屜底部;
 * `md` 以上(橫拿平板、電腦)是完整版頂部列與常駐側欄。三者一起切換(主選單鈕打開的就是抽屜、抽屜底部補的就是頂部列移走的),
 * 所以 `AppBar` / `SideNav` 都經 `useIsShellCompact` 判斷,不各寫一次斷點。
 * 內容區內距(`MAIN_PADDING`)與頂部列左右內距是另一回事,仍以 `sm` 為界(只有手機寬才縮)。
 */
export const SHELL_COMPACT_BELOW = "md" as const;

/** 視窗是否小於殼的精簡版界線(`SHELL_COMPACT_BELOW`)。 */
export const useIsShellCompact = (): boolean =>
  useBreakpointDown(SHELL_COMPACT_BELOW);

/**
 * 內容區的最小寬度以哪個主題斷點為準(**只在視窗 ≥ `lg` 時套用**;平板以下不設下限,內容隨視窗縮放):
 * 殼層預設 `lg`,頁面可在登記時以 `minWidth` 宣告更大的 `xl`
 * (`app/base/module-pages.ts`;目前底座頁都沒宣告),合成後是 `app/module-pages.tsx` 的 `modulePageMinWidths`。
 * 因為只在 ≥ `lg` 套用,`lg` 在那個寬度本來就放得下,實際會讓 `<main>` 水平捲動的只有 `xl`(視窗介於 `lg` 與 `xl` 之間時)。
 * 比 `lg` 小的斷點沒有意義(< `lg` 本來就不設下限),所以型別只收這兩個。
 */
export type ShellMinWidth = "lg" | "xl";

export const DEFAULT_SHELL_MIN_WIDTH: ShellMinWidth = "lg";

/**
 * 「視窗寬 = 斷點值」時內容區剛好放得下的最小寬度:斷點 − 側欄(隨收合狀態)− 內容區左右內距
 * (最小寬度只在 `lg` 以上套用,所以取 `sm` 起的內距)。
 * 視窗比斷點窄 → `<main>` 自己水平捲動(`overflow: auto`),不擠壓內容;比斷點寬 → 不捲。
 * 側欄收合時側欄變窄,最小寬度跟著重算(否則收合後內容區多出一截、無故出現水平捲軸)。
 * 回 CSS `calc()`:theme 開了 `cssVariables`,`spacing()` 回的可能是 `var()` 算式,不能當數字相減。
 */
export const shellContentMinWidth = (
  breakpointPx: number,
  spacing: (units: number) => string,
  isNavCollapsed: boolean,
): string =>
  `calc(${String(breakpointPx)}px - ${spacing(
    isNavCollapsed ? NAV_COLLAPSED_WIDTH : NAV_WIDTH,
  )} - ${spacing(MAIN_PADDING.sm * 2)})`;
