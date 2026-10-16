import { useTranslations } from "use-intl";

import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";

import { ShellLayout } from "./ShellLayout";
import type { ShellMinWidth } from "./shell-geometry";

export interface AdminShellProps {
  /** 模組 key → 內容區最小寬度的斷點(沒列 = `lg`;見 `shell-geometry.ts`) */
  pageMinWidths?: Readonly<Record<string, ShellMinWidth>>;
}

/**
 * 登入後的後台殼(#66;Figma Admin Shell 頁:Draft/AdminSideNav 30:52 + Draft/AdminAppBar 30:95 + Draft/AdminRouteTabs 34:33):
 * `me` 走 `useMe()` 全域快取(RequireAuth 已等它載入;首登強改的導向也在 RequireAuth,殼不重複判斷),
 * 載到後交給 `ShellLayout` 排版(側欄 + AppBar + 路由頁籤列 + 內容區)。
 */
export const AdminShell = ({ pageMinWidths }: AdminShellProps) => {
  const tApp = useTranslations("admin.app");
  const me = useMe();

  if (me.isPending) {
    return <Typography sx={{ p: 4 }}>{tApp("loading")}</Typography>;
  }
  if (me.isError) {
    return (
      <Typography role="alert" sx={{ p: 4 }}>
        {tApp("apiError")}
      </Typography>
    );
  }
  return (
    <ShellLayout
      me={me.data.me}
      {...(pageMinWidths !== undefined && { pageMinWidths })}
    />
  );
};
