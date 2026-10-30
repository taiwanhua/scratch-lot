/**
 * 閃爍提示的樣式:外框主色光暈淡出一次(動畫長度是設計值,集中在這裡;STYLE-06)。
 * 套在要提示的元件 `sx` 上;要再閃一次就換元件的 `key`(序號由 `hooks/base/useFlashTarget` 提供),
 * 元件重掛才會重播動畫。元件另標 `data-flash="true"`,測試與 E2E 以它確認有閃。
 */
export const FLASH_HIGHLIGHT_SX = {
  animation: "flash-highlight 1.2s ease-out 1",
  "@keyframes flash-highlight": {
    "0%": { boxShadow: "0 0 0 4px var(--mui-palette-primary-main)" },
    "100%": { boxShadow: "0 0 0 0 transparent" },
  },
} as const;
