import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";
import { Stack, type StackProps } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface AuthCardProps {
  /** 品牌名下方的一行(登入頁「後台管理系統」、其他頁為頁名) */
  subtitle: string;
  /** 型別沿用 ui 套件的 ReactNode(admin 與 ui 的 @types/react 小版本不同,直接用 React.ReactNode 會不相容) */
  children: StackProps["children"];
}

/**
 * 登入線四頁共用的版型(Figma「Admin 登入 LoginCard」17:5 及其複本:忘記密碼 120:1534、
 * 設定新密碼 120:1583;品牌文字登記於 docs/branding.md):置中卡片 + 品牌 + 頁腳。
 */
export const AuthCard = ({ subtitle, children }: AuthCardProps) => {
  const tCommon = useTranslations("common");
  const tLogin = useTranslations("admin.login");

  return (
    <Stack
      component="main"
      spacing={3}
      sx={{
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        px: 2,
      }}
    >
      <Card
        sx={{
          width: "100%",
          maxWidth: 400,
          p: 5,
          boxShadow: (theme) => theme.customShadows.dialog,
        }}
      >
        <Stack spacing={2.5}>
          <Stack spacing={0.5} sx={{ alignItems: "center" }}>
            <Typography variant="h4" color="primary">
              {tCommon("brand")}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {subtitle}
            </Typography>
          </Stack>
          {children}
        </Stack>
      </Card>

      <Typography variant="caption" color="textDisabled">
        {tLogin("footer", {
          year: new Date().getFullYear(),
          brand: tCommon("brand"),
        })}
      </Typography>
    </Stack>
  );
};
