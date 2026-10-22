import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgSwitcher } from "@/components/base/OrgSwitcher/OrgSwitcher";
import { useMe } from "@/hooks/base/useMe";

/**
 * 站在根組織(平台層級,`me.currentOrg.tenantId == null`)打開專案功能時的提示:根組織不屬於任何機構,
 * 沒有店面、庫存、帳戶、排班這些資料,要看某個機構的資料先切進那個機構(ADR-0014、Spec #143 定案 8)。
 * 切換入口沿用 AppBar 的當前組織切換器。api 對同一情況回 `FORBIDDEN` + reason `TENANT_ONLY`。
 */
export const RootOrgNotice = () => {
  const t = useTranslations("admin.projectShell.rootOrg");
  const me = useMe();
  const data = me.data?.me;
  return (
    <Card sx={{ p: { xs: 2, sm: 3 }, flexShrink: 0 }}>
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Alert severity="info" sx={{ alignSelf: "stretch" }}>
          {t("message")}
        </Alert>
        <Typography variant="body2" color="text.secondary">
          {t("hint")}
        </Typography>
        {data === undefined ? null : <OrgSwitcher me={data} />}
      </Stack>
    </Card>
  );
};
