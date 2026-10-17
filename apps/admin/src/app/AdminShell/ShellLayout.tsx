import { useMemo } from "react";
import { Outlet, useLocation } from "react-router";
import { useTranslations } from "use-intl";

import type { MeQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";

import { useSidebarBadges } from "@/hooks/base/useSidebarBadges";
import {
  buildNavTree,
  enterableRouteMap,
  findNavNode,
  firstLinkRoute,
  matchModuleRoute,
  normalizePathname,
} from "@/lib/base/module-tree";
import { withShellRoutes } from "@/lib/base/shell-routes";
import { useSideNavStore } from "@/stores/base/useSideNavStore";

import { AppBar } from "./AppBar/AppBar";
import { RouteTabs } from "./RouteTabs/RouteTabs";
import { useRouteTabs } from "./RouteTabs/useRouteTabs";
import { SideNav } from "./SideNav/SideNav";
import {
  DEFAULT_SHELL_MIN_WIDTH,
  MAIN_PADDING,
  type ShellMinWidth,
  shellContentMinWidth,
} from "./shell-geometry";

export interface ShellLayoutProps {
  me: MeQuery["me"];
  /** 模組 key → 該頁內容區最小寬度的斷點(沒列 = `lg`;`app/module-pages.tsx` 的 `modulePageMinWidths`) */
  pageMinWidths?: Readonly<Record<string, ShellMinWidth>>;
}

/**
 * 殼的排版:側欄 + AppBar + 路由頁籤列(#67)+ 內容區(`<Outlet>`);只給 `AdminShell` 用(`me` 已載入)。
 *
 * **高度是殼給的**(#183):外框釘死 `100vh`,內容區 = 視窗高 − AppBar − RouteTabs,
 * 由 `flex: 1` + `minHeight: 0` 取得一個**確定的高度**並自己捲動。
 * 頁面因此可以用 `flex: 1` / `height: 100%` 撐滿(組織管理、使用者管理的左右兩欄就是這樣滿版);
 * 內容比視窗高的頁面照舊在內容區捲動,不會被裁掉。
 *
 * **寬度也有下限**(非手機版面):內容區的最小寬度 = 主題斷點(預設 `lg`,頁面可宣告 `xl`)− 側欄 − 內距,
 * 視窗比斷點窄時由 `<main>` 水平捲動,不擠壓內容;側欄收合時跟著重算,document 本身永遠不出現水平捲軸
 * (外框 `overflow: hidden`,主欄 `minWidth: 0`)。幾何在 `shell-geometry.ts`。
 */
export const ShellLayout = ({ me, pageMinWidths = {} }: ShellLayoutProps) => {
  const t = useTranslations("admin.shell");
  const tCommon = useTranslations("common");
  const { pathname, search } = useLocation();
  const { modules } = me;

  const tree = useMemo(() => buildNavTree(modules), [modules]);
  const tPersonalSettings = useTranslations("admin.personalSettings");
  const personalSettingsLabel = tPersonalSettings("title");
  // 可進入路由集合 + 殼層路由(個人設定):頁名、「?」說明、路由頁籤與模組頁走同一條路
  const routes = useMemo(
    () =>
      withShellRoutes(enterableRouteMap(modules), {
        personalSettings: personalSettingsLabel,
      }),
    [modules, personalSettingsLabel],
  );

  const path = normalizePathname(pathname);
  const routeTabs = useRouteTabs({
    userId: me.id,
    routes,
    currentPath: path,
    currentSearch: search,
  });
  // 目前網址對上的模組(可進入路由集合,ADR-0011);非模組路由為 undefined。
  // 用 `matchModuleRoute` 而不是 `routes.get(path)`:隱藏的詳情 / 編輯頁網址尾端帶識別碼,
  // 精準比對會落空,標題就會閃成「無權限」、「?」說明鈕也跟著不見(#320)
  const currentModule = matchModuleRoute(routes, path)?.module;
  // `/` 與群組路由由 ModuleRoute 轉到底下第一個能進的頁(與它同一條規則:`firstLinkRoute`),
  // 轉走前那一次 render 標題留空,不閃「無權限」;群組底下沒有能進的頁 → 停在無權限頁,標題照常
  const redirectScope = path === "/" ? tree : findNavNode(tree, path)?.children;
  const isRedirectPath =
    path === "/" ||
    (redirectScope !== undefined && firstLinkRoute(redirectScope) !== null);
  const title =
    currentModule?.name ?? (isRedirectPath ? "" : t("forbidden.title"));
  const minWidth =
    (currentModule === undefined
      ? undefined
      : pageMinWidths[currentModule.key]) ?? DEFAULT_SHELL_MIN_WIDTH;
  const isNavCollapsed = useSideNavStore((state) => state.isCollapsed);
  // 側欄計數登記制(底座規格 10.4):模組 key → 數字,來自 `sidebarBadges`(只含看得到的模組);
  // 進站取一次,之後靠 `badge:<模組 key>` 信號重抓(斷線時跟即時通道降級每 60 秒一次)
  const navBadges = useSidebarBadges();

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <SideNav
        orgName={me.currentOrg?.name ?? tCommon("brand")}
        logoUrl={me.currentOrg?.logoUrl}
        tree={tree}
        currentPath={path}
        badges={navBadges}
      />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <AppBar me={me} title={title} module={currentModule} />
        <RouteTabs
          tabs={routeTabs.tabs}
          activeRoute={routeTabs.activeRoute}
          onSelect={routeTabs.select}
          onClose={routeTabs.close}
          onMove={routeTabs.move}
        />
        {/* `flex: 1` 的 basis 是 0,所以 AppBar / RouteTabs 不會被內容擠扁;
            `minHeight: 0` 讓這一格的高度真的等於剩下的空間(否則會被內容撐高) */}
        <Box
          component="main"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            p: MAIN_PADDING,
          }}
        >
          {/* 內容的最小寬度(非手機版面):視窗比斷點窄時由 <main> 水平捲動,不擠壓內容;
              高度鏈照舊往下傳(`flex: 1` + `minHeight: 0`,STYLE-08) */}
          <Box
            data-testid="shell-content"
            sx={(theme) => ({
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              minWidth: {
                xs: 0,
                sm: shellContentMinWidth(
                  theme.breakpoints.values[minWidth],
                  theme.spacing,
                  isNavCollapsed,
                ),
              },
            })}
          >
            <Outlet />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
