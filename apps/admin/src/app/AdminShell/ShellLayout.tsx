import { useMemo } from "react";
import { Outlet, useLocation } from "react-router";
import { useTranslations } from "use-intl";

import type { MeQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";

import { useApplyCenterCounts } from "@/hooks/base/useApplyCenterCounts";
import {
  buildNavTree,
  enterableRouteMap,
  findNavNode,
  firstLinkRoute,
  matchModuleRoute,
  normalizePathname,
} from "@/lib/base/module-tree";
import { APPLY_CENTER_MODULE_KEY } from "@/pages/base/apply-center/apply-center-keys";
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
  const { pathname } = useLocation();
  const { modules } = me;

  const tree = useMemo(() => buildNavTree(modules), [modules]);
  const routes = useMemo(() => enterableRouteMap(modules), [modules]);

  const path = normalizePathname(pathname);
  const routeTabs = useRouteTabs({ userId: me.id, routes, currentPath: path });
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
  // 側欄「申請中心」右側 = 待我處理的任務數(進站取一次,之後隨送出 / 審核 / 改派等寫入失效重查)
  const { myTasks } = useApplyCenterCounts();
  const navBadges = useMemo(
    () => ({ [APPLY_CENTER_MODULE_KEY]: myTasks }),
    [myTasks],
  );

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
