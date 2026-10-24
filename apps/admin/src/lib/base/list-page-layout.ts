/** 列表頁殼釘高的寬度起點(MUI `md`,900px)。 */
export const LIST_PAGE_PIN_BREAKPOINT = "md" as const;

/**
 * 列表頁殼釘高的視窗高度下限(px)。比它矮的視窗(例:1024×600 的平板橫放)扣掉頁首、工具列、分頁器後,
 * 表格只剩約 94px 可捲,不如整頁交給 `<main>` 捲(與 `md` 以下相同)。
 */
export const LIST_PAGE_PIN_MIN_HEIGHT = 720;

/** `listPagePinMediaQuery` 用到的 theme 部分(apps 不直接拿 MUI 型別,STYLE-05)。 */
interface PinBreakpointTheme {
  readonly breakpoints: {
    readonly up: (key: typeof LIST_PAGE_PIN_BREAKPOINT) => string;
  };
}

/**
 * 列表頁殼釘高的媒體查詢(**唯一正本**):寬 ≥ `md` **且** 視窗高 ≥ `LIST_PAGE_PIN_MIN_HEIGHT`。
 * 寬度取 theme 斷點(STYLE-03),再接上高度條件;要跟頁殼同步釘高 / 開捲動的樣式一律用它,不另寫媒體查詢。
 * 結果例:`@media (min-width:900px) and (min-height:720px)`。
 */
export const listPagePinMediaQuery = (theme: PinBreakpointTheme): string =>
  `${theme.breakpoints.up(LIST_PAGE_PIN_BREAKPOINT)} and (min-height:${String(LIST_PAGE_PIN_MIN_HEIGHT)}px)`;

/**
 * 列表頁的頁殼(STYLE-08):列表頁卡片、列表分頁的分頁殼卡片、列表頁最外層的 Stack。
 *
 * - **寬 ≥ `md` 且視窗高 ≥ 720px 時釘住殼給的高度**(`flex: 1` + `minHeight: 0`;條件見 `listPagePinMediaQuery`):
 *   表格容器在卡片裡自己捲,表頭固定(`@repo/ui/table` 的 stickyHeader),工具列與分頁器一直看得到
 * - **其餘不釘高**(`flex: 1 0 auto`:`md` 以下,或寬但矮的視窗):內容少時撐滿、多時跟著長,
 *   整頁交給 `<main>` 捲,表頭跟著捲
 *
 * 只給「子樹有一層 `flex: 1; minHeight: 0` 接上來的捲動容器能吃掉超出量」的列表頁;
 * 表單、設定、看板這類內容頁一律 `flexGrow: 1; flexShrink: 0`(整頁捲)。
 * 它是 theme 函式(媒體查詢取 theme 斷點),呼叫端用 `sx` 陣列疊上自己的 `display` / 內距:
 * `sx={[LIST_PAGE_SHELL_SX, { px: 3 }]}`。
 */
export const LIST_PAGE_SHELL_SX = (theme: PinBreakpointTheme) => ({
  flex: "1 0 auto",
  minHeight: 0,
  [listPagePinMediaQuery(theme)]: { flex: 1 },
});

/**
 * 內容頁的頁殼(STYLE-08):表單、設定、看板這類內容頁與它們的分頁殼。
 * 內容少時撐滿、多時跟著長,整頁交給 `<main>` 捲;不釘高也不被壓扁(`Card` 預設 `overflow: hidden`)。
 */
export const CONTENT_PAGE_SHELL_SX = { flexGrow: 1, flexShrink: 0 } as const;
