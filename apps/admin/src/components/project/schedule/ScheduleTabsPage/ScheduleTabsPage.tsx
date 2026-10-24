import type { ComponentType } from "react";
import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { Typography } from "@repo/ui/typography";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { usePageTabsShellSx } from "@/components/base/PageTabs/usePageTabsShellSx";
import { usePermissions } from "@/hooks/base/usePermissions";

/**
 * 班表管理四個頁面的分頁登記(`pages/project/schedule/<模組>/<模組>-tabs.ts`):一個分頁一列,
 * 每個功能只追加自己那一列(檔案由第一張票建,之後的票各自加一列)。
 */
export interface ScheduleTabEntry {
  /** 網址 `?tab=` 的值(同一頁內唯一) */
  value: string;
  /** 分頁籤文字的 i18n key(`admin.schedule.tabs.<labelKey>`) */
  labelKey: string;
  /** 看得到這個分頁要的權限;不給 = 看得到這一頁的人都看得到 */
  permission?: string;
  /** 列表分頁:平板以上分頁殼釘高、表格在卡片裡捲(`PageTabItem.isList`);不給 = 內容分頁,整頁捲 */
  isList?: boolean;
  /** 分頁內容 */
  Content: ComponentType;
}

export interface ScheduleTabsPageProps {
  /** 分頁列的無障礙名稱(模組名稱) */
  title: string;
  tabs: readonly ScheduleTabEntry[];
}

/**
 * 班表管理的頁殼:底座 `PageTabs`(與網址同步、依權限隱藏;只剩一個分頁時不顯示分頁籤,規格 3.1)。
 * 還沒有任何分頁(之後的票才加)或分頁全看不到時,顯示一句說明。
 */
export const ScheduleTabsPage = ({ title, tabs }: ScheduleTabsPageProps) => {
  const t = useTranslations("admin.schedule");
  const { hasPermission } = usePermissions();
  const items: PageTabItem[] = tabs.map(
    ({ value, labelKey, permission, isList, Content }) => ({
      value,
      label: t(`tabs.${labelKey}`),
      ...(permission === undefined ? {} : { permission }),
      ...(isList === true ? { isList } : {}),
      content: <Content />,
    }),
  );
  const shellSx = usePageTabsShellSx(items);
  const hasVisible = tabs.some(
    (tab) => tab.permission === undefined || hasPermission(tab.permission),
  );

  return (
    // 分頁殼(STYLE-08):列表分頁平板以上釘高、表格在卡片裡捲;內容分頁與手機寬整頁捲
    <Card
      sx={[
        shellSx,
        {
          display: "flex",
          flexDirection: "column",
          px: { xs: 2, sm: 3 },
          py: 2,
        },
      ]}
    >
      {hasVisible ? (
        <PageTabs aria-label={title} items={items} />
      ) : (
        <Typography color="textSecondary">{t("shell.empty")}</Typography>
      )}
    </Card>
  );
};
