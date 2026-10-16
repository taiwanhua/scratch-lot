import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";

import { PreferencesTab } from "./PreferencesTab";

/** 分頁的網址值(`?tab=`);不帶或認不得 → 第一個分頁(偏好)。 */
export const PREFERENCES_TAB = "preferences";

/**
 * 個人設定(規格 10.6;Figma BS-05 `257:4821`):殼層路由 `/settings/personal`,不是模組、不需要權限。
 * 分頁「偏好 | 代理人」記在網址 `?tab=`(PageTabs);只有一個分頁時不顯示分頁籤。
 * 語言與外觀不在這裡 —— 兩者只放頭像選單,切了立即生效。
 */
export const PersonalSettingsPage = () => {
  const t = useTranslations("admin.personalSettings");

  const items: PageTabItem[] = [
    {
      value: PREFERENCES_TAB,
      label: t("tabPreferences"),
      content: <PreferencesTab />,
    },
  ];

  return (
    <Card sx={{ px: 3, py: 2 }}>
      <PageTabs aria-label={t("tabs")} items={items} />
    </Card>
  );
};
