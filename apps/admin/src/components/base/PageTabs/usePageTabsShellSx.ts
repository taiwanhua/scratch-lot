import {
  CONTENT_PAGE_SHELL_SX,
  LIST_PAGE_SHELL_SX,
} from "@/lib/base/list-page-layout";

import type { PageTabItem } from "./page-tab-item";
import { usePageTabs } from "./usePageTabs";

/**
 * 分頁殼(PageTabs 外面那張卡片)的高度樣式,依目前分頁決定(STYLE-08):
 * 列表分頁(`isList`)用列表頁殼(平板以上釘高、表格在卡片裡捲),其餘用內容頁殼(整頁捲)。
 * 分頁混著列表與內容的頁用它;分頁全是列表的頁直接用 `LIST_PAGE_SHELL_SX`。
 * 呼叫端照常疊上自己的 `display` / 內距:`sx={{ ...shellSx, px: 3 }}`。
 */
export const usePageTabsShellSx = (
  items: readonly PageTabItem[],
  urlKey = "tab",
) => {
  const { current } = usePageTabs(items, urlKey);
  return current?.isList === true ? LIST_PAGE_SHELL_SX : CONTENT_PAGE_SHELL_SX;
};
