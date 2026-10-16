import { useTranslations } from "use-intl";

import { Typography } from "@repo/ui/typography";

/**
 * 「偏好」分頁(規格 10.6):放跟著帳號的個人偏好 —— 每種通知類型的管道開關(由通知設定登記後加進來)。
 * 語言不在這裡(只放頭像選單);顯示密度不做(規格第 11 章 B 類)。目前還沒有項目,先顯示說明。
 */
export const PreferencesTab = () => {
  const t = useTranslations("admin.personalSettings");

  return (
    <Typography variant="body2" color="text.secondary">
      {t("preferencesEmpty")}
    </Typography>
  );
};
