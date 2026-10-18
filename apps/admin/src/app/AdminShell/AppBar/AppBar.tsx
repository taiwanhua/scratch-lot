import type { MeQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Typography } from "@repo/ui/typography";

import { NotificationBell } from "@/components/base/NotificationBell/NotificationBell";
import type { ShellModule } from "@/lib/base/module-tree";

import { HelpButton } from "./HelpButton";
import { OrgSwitcher } from "./OrgSwitcher";
import { UserMenu } from "./UserMenu";

/** AppBar 高度(theme.spacing 單位;Figma AdminAppBar 64 高)。 */
const BAR_HEIGHT = 8;

export interface AppBarProps {
  me: MeQuery["me"];
  /** 目前頁面的名稱(模組名 / 總覽) */
  title: string;
  /**
   * 目前網址對上的模組(殼已由 `enterableRouteMap` 查好,不再查一次);
   * 非模組路由(`/`、群組路由、無權限頁)為 undefined,此時不顯示「?」。
   */
  module?: ShellModule;
}

/** 後台 AppBar(Figma Draft/AdminAppBar):頁名、模組說明「?」、通知鈴、當前組織切換器、使用者選單(Draft/AdminUserMenu:使用者卡、外觀、語言、個人設定、登出 / 登出所有裝置)。 */
export const AppBar = ({ me, title, module }: AppBarProps) => (
  <Box
    component="header"
    sx={{
      height: (theme) => theme.spacing(BAR_HEIGHT),
      display: "flex",
      alignItems: "center",
      gap: 2,
      pl: 4,
      pr: 3,
      bgcolor: "background.paper",
      borderBottom: 1,
      borderColor: "divider",
    }}
  >
    {/* 頁名只是標示,不是內容區的標題(h1 在內容區),故不用 heading 標籤 */}
    <Typography variant="h6" component="div" noWrap>
      {title}
    </Typography>
    {/* 「?」模組說明彈窗(dis #18;Figma help-button I44:119;81:51):只有模組路由才有 */}
    {module !== undefined && (
      <HelpButton
        moduleKey={module.key}
        moduleName={module.name}
        moduleEngine={module.engine}
      />
    )}
    <Box sx={{ flex: 1 }} />

    {/* 通知鈴:組織切換器左邊,所有登入者都有 */}
    <NotificationBell />
    <OrgSwitcher me={me} />
    <UserMenu
      name={me.name}
      account={me.account}
      orgName={me.currentOrg?.name}
    />
  </Box>
);
