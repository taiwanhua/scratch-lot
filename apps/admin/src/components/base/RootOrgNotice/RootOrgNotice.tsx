import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgSwitcher } from "@/components/base/OrgSwitcher/OrgSwitcher";
import { useMe } from "@/hooks/base/useMe";

export interface RootOrgNoticeProps {
  /** 主訊息;不給用預設(`admin.shell.rootOrgNotice.message`)。 */
  message?: string;
  /** 補充說明;不給用預設(`admin.shell.rootOrgNotice.hint`)。 */
  hint?: string;
  /**
   * `page`(預設):整頁的提示卡片(`withTenantRequired` 用);
   * `inline`:頁內一段、不包卡片,給只有部分功能要在最上層組織底下用的頁面。
   */
  variant?: "page" | "inline";
}

/**
 * 站在根組織(`me.currentOrg.tenantId === null`)打開只在最上層組織底下有意義的功能時的提示:
 * 主訊息 + 補充說明 + 當前組織切換器(與 AppBar 同一個 `OrgSwitcher`),切換後原處就換成那個組織的內容。
 * api 對同一情況回 `FORBIDDEN` + reason `TENANT_ONLY`;這裡只是先講清楚,真正的守門在 api。
 */
export const RootOrgNotice = ({
  message,
  hint,
  variant = "page",
}: RootOrgNoticeProps) => {
  const t = useTranslations("admin.shell.rootOrgNotice");
  const me = useMe();
  const data = me.data?.me;
  const content = (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Alert severity="info" sx={{ alignSelf: "stretch" }}>
        {message ?? t("message")}
      </Alert>
      <Typography variant="body2" color="textSecondary">
        {hint ?? t("hint")}
      </Typography>
      {data === undefined ? null : <OrgSwitcher me={data} />}
    </Stack>
  );
  if (variant === "inline") {
    return content;
  }
  return <Card sx={{ p: { xs: 2, sm: 3 }, flexShrink: 0 }}>{content}</Card>;
};
