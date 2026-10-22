import { useTranslations } from "use-intl";

import type { MeQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { IconButton } from "@repo/ui/icon-button";
import { MenuIcon } from "@repo/ui/icons";
import { Typography } from "@repo/ui/typography";

import { NotificationBell } from "@/components/base/NotificationBell/NotificationBell";
import { OrgSwitcher } from "@/components/base/OrgSwitcher/OrgSwitcher";
import type { ShellModule } from "@/lib/base/module-tree";
import { useSideNavStore } from "@/stores/base/useSideNavStore";

import { SIDE_NAV_DRAWER_ID } from "../SideNav/SideNav";
import { useIsShellCompact } from "../shell-geometry";
import { HelpButton } from "./HelpButton";
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

/**
 * 後台 AppBar(Figma Draft/AdminAppBar):頁名、模組說明「?」、通知鈴、當前組織切換器、使用者選單(Draft/AdminUserMenu:使用者卡、外觀、語言、個人設定、登出 / 登出所有裝置)。
 * 精簡版(手機與直拿平板,< `md`,界線見 `shell-geometry.ts` 的 `SHELL_COMPACT_BELOW`)只留:主選單鈕(打開側欄抽屜)、
 * 頁名(放不下以省略號截斷)、通知鈴、精簡版組織切換(首字小按鈕);「?」說明與頭像選單移到抽屜底部(`SideNav/MobileNavFooter`)。
 * 左右內距與間距只在手機寬(< `sm`)縮小。`md` 以上是完整版。
 */
export const AppBar = ({ me, title, module }: AppBarProps) => {
  const t = useTranslations("admin.shell");
  const isCompact = useIsShellCompact();
  const isNavOpen = useSideNavStore((state) => state.isMobileOpen);
  const setNavOpen = useSideNavStore((state) => state.setMobileOpen);

  return (
    <Box
      component="header"
      sx={{
        height: (theme) => theme.spacing(BAR_HEIGHT),
        display: "flex",
        alignItems: "center",
        gap: { xs: 1, sm: 2 },
        pl: { xs: 1, sm: 4 },
        pr: { xs: 1, sm: 3 },
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      {isCompact && (
        <IconButton
          aria-label={t("openNav")}
          aria-expanded={isNavOpen}
          aria-controls={SIDE_NAV_DRAWER_ID}
          onClick={() => {
            setNavOpen(true);
          }}
        >
          <MenuIcon />
        </IconButton>
      )}
      {/* 頁名只是標示,不是內容區的標題(h1 在內容區),故不用 heading 標籤 */}
      <Typography variant="h6" component="div" noWrap sx={{ minWidth: 0 }}>
        {title}
      </Typography>
      {/* 「?」模組說明彈窗(Figma help-button I44:119;81:51):只有模組路由才有;精簡版改放抽屜底部 */}
      {!isCompact && module !== undefined && (
        <HelpButton
          moduleKey={module.key}
          moduleName={module.name}
          moduleEngine={module.engine}
        />
      )}
      {/* 撐開的空白:頁名放不下時讓它先縮(flex-shrink),右側按鈕不被擠出畫面 */}
      <Box sx={{ flex: 1, minWidth: 0 }} />

      {/* 通知鈴:組織切換器左邊,所有登入者都有 */}
      <NotificationBell />
      <OrgSwitcher me={me} isCompact={isCompact} />
      {/* 頭像選單:精簡版改放抽屜底部 */}
      {!isCompact && (
        <UserMenu
          name={me.name}
          account={me.account}
          orgName={me.currentOrg?.name}
        />
      )}
    </Box>
  );
};
