import type { ComponentType } from "react";
import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { Typography } from "@repo/ui/typography";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
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
    ({ value, labelKey, permission, Content }) => ({
      value,
      label: t(`tabs.${labelKey}`),
      ...(permission === undefined ? {} : { permission }),
      content: <Content />,
    }),
  );
  const hasVisible = tabs.some(
    (tab) => tab.permission === undefined || hasPermission(tab.permission),
  );

  return (
    // 一般內容頁殼(STYLE-08):內容少時撐滿、多時跟著長,交給 <main> 捲;不釘高(Card 預設 overflow: hidden,釘高會裁掉內容)
    <Card
      sx={{
        flexGrow: 1,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        px: { xs: 2, sm: 3 },
        py: 2,
      }}
    >
      {hasVisible ? (
        <PageTabs aria-label={title} items={items} />
      ) : (
        <Typography color="text.secondary">{t("shell.empty")}</Typography>
      )}
    </Card>
  );
};
