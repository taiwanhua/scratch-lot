import type { ReactNode } from "react";

import type { TabItem } from "@repo/ui/tabs";

/** PageTabs 的一個分頁:`@repo/ui/tabs` 的頁籤 + 權限 + 內容。 */
export interface PageTabItem extends TabItem {
  /** 看得到這個分頁需要的權限 key(`hasPermission` 判斷);不給 = 人人看得到 */
  permission?: string;
  /**
   * 列表分頁(長表格):選到它時分頁殼用列表頁殼 —— 平板以上且視窗夠高時釘高、表格在卡片裡捲(表頭固定),
   * 手機寬與矮視窗整頁捲(`usePageTabsShellSx`、STYLE-08)。不給 = 內容分頁,整頁捲。
   */
  isList?: boolean;
  /** 選到這個分頁時顯示的內容;沒選到的分頁不掛載 */
  content: ReactNode;
}
