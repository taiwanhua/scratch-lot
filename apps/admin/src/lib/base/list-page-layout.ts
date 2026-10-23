/** 列表頁殼在平板以上才釘高的斷點(MUI `md`,900px)。 */
export const LIST_PAGE_PIN_BREAKPOINT = "md" as const;

/**
 * 列表頁的頁殼(STYLE-08):列表頁卡片、列表分頁的分頁殼卡片、列表頁最外層的 Stack。
 *
 * - **平板以上(`md` 起)釘住殼給的高度**(`flex: 1` + `minHeight: 0`):表格容器在卡片裡自己捲,
 *   表頭固定(`@repo/ui/table` 的 stickyHeader),工具列與分頁器一直看得到
 * - **`md` 以下不釘高**(`flex: 1 0 auto`):內容少時撐滿、多時跟著長,整頁交給 `<main>` 捲,表頭跟著捲
 *
 * 只給「子樹有一層 `flex: 1; minHeight: 0` 接上來的捲動容器能吃掉超出量」的列表頁;
 * 表單、設定、看板這類內容頁一律 `flexGrow: 1; flexShrink: 0`(整頁捲)。
 * 呼叫端照常疊上自己的 `display` / 內距:`sx={{ ...LIST_PAGE_SHELL_SX, px: 3 }}`。
 */
export const LIST_PAGE_SHELL_SX = {
  flex: { xs: "1 0 auto", [LIST_PAGE_PIN_BREAKPOINT]: 1 },
  minHeight: 0,
} as const;

/**
 * 內容頁的頁殼(STYLE-08):表單、設定、看板這類內容頁與它們的分頁殼。
 * 內容少時撐滿、多時跟著長,整頁交給 `<main>` 捲;不釘高也不被壓扁(`Card` 預設 `overflow: hidden`)。
 */
export const CONTENT_PAGE_SHELL_SX = { flexGrow: 1, flexShrink: 0 } as const;
