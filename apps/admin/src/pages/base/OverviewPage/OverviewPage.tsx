import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";

/**
 * 總覽(模組 key `overview`,正本 docs/modules/overview.md):登入後的第一頁。
 * 本輪只有佔位內容(問候 + 當前組織,沿用 #65 的驗證頁);統計卡等實際內容待後續票。
 */
export const OverviewPage = () => {
  const t = useTranslations("admin.session");
  const me = useMe();
  if (me.data === undefined) {
    return null;
  }
  const { name, currentOrg } = me.data.me;

  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        {t("greeting", { name })}
      </Typography>
      <Typography color="text.secondary">
        {currentOrg ? t("currentOrg", { org: currentOrg.name }) : t("noOrg")}
      </Typography>
    </Stack>
  );
};
