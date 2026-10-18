import { type ReactNode, useId } from "react";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";

import type { PageTabItem } from "./page-tab-item";
import { usePageTabs } from "./usePageTabs";

export type { PageTabItem } from "./page-tab-item";

export interface PageTabsProps {
  items: readonly PageTabItem[];
  /** 目前分頁記在網址的哪個 key;同一頁有兩組分頁時才需要改 */
  urlKey?: string;
  /** 分頁列的無障礙名稱 */
  "aria-label"?: string;
  /** 分頁列右側的動作(例:申請中心的「新申請」);只剩一個分頁、不顯示分頁籤時仍保留 */
  actions?: ReactNode;
  /** 使用者切換分頁後(網址已寫入)通知呼叫端,例:切頁籤時重取數字 */
  onChange?: (value: string) => void;
  /** 分頁列與內容之間的間距(theme.spacing 單位);預設 2 */
  spacing?: number;
}

/**
 * 頁內分頁(規格 10.1):建在 `@repo/ui/tabs` 上,只多兩件事 ——
 * **目前分頁記在網址**(`useUrlState`,預設 `?tab=<value>`,重新整理、分享網址都回到同一頁),
 * **分頁可設權限**(沒權限就不顯示)。只剩一個分頁時不顯示分頁籤,直接顯示內容。
 * 放不下時單列橫向捲動(`scrollable`),選到的分頁自動捲進可視範圍。
 *
 * 與殼的路由頁籤 `RouteTabs` 無關:那一列是開過的路由,這裡是同一頁裡的分區。
 */
export const PageTabs = ({
  items,
  urlKey = "tab",
  "aria-label": ariaLabel,
  actions,
  onChange,
  spacing = 2,
}: PageTabsProps) => {
  const { visibleItems, current, select } = usePageTabs(items, urlKey);
  const idBase = useId();
  const tabId = (value: string) => `${idBase}-tab-${value}`;
  const panelId = (value: string) => `${idBase}-panel-${value}`;

  if (current === undefined) {
    return null;
  }

  const showTabs = visibleItems.length > 1;
  // 分頁籤與內容區互相指:tab 的 aria-controls → 內容區,內容區(role="tabpanel")的 aria-labelledby → tab
  const tabItems = visibleItems.map((item) => ({
    ...item,
    id: tabId(item.value),
    "aria-controls": panelId(item.value),
  }));

  return (
    <Stack spacing={spacing} sx={{ flex: 1, minHeight: 0 }}>
      {(showTabs || actions !== undefined) && (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          {/* minWidth 0:讓分頁列在 flex 裡可以比內容窄,才會出現橫向捲動 */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {showTabs && (
              <Tabs
                scrollable
                aria-label={ariaLabel}
                value={current.value}
                items={tabItems}
                onChange={(next) => {
                  select(next);
                  onChange?.(next);
                }}
              />
            )}
          </Box>
          {actions}
        </Stack>
      )}
      {showTabs ? (
        <Box
          role="tabpanel"
          id={panelId(current.value)}
          aria-labelledby={tabId(current.value)}
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {current.content}
        </Box>
      ) : (
        current.content
      )}
    </Stack>
  );
};
