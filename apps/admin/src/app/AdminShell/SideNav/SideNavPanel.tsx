import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Avatar } from "@repo/ui/avatar";
import { Box } from "@repo/ui/box";
import { List } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { NavBadges } from "@/hooks/base/useSidebarBadges";
import type { NavNode } from "@/lib/base/module-tree";

import { NAV_COLLAPSED_WIDTH, NAV_WIDTH } from "../shell-geometry";
import { NavNodes } from "./NavNodes/NavNodes";
import { NavRail } from "./NavRail/NavRail";
import { SideNavToggle } from "./SideNavToggle";

/** 商標槽位的幾何(Figma AdminSideNav 的 logoImg 120:50:28×28、圓角 6)。 */
const LOGO_SIZE = 28;
const LOGO_RADIUS = "6px";

export interface SideNavContentProps {
  /** 頂部租戶識別:沒有商標時顯示的當前組織名稱 */
  orgName: string;
  /** 當前組織的商標(`me.currentOrg.logoUrl`,api 現簽的短效網址);沒有就顯示名稱 */
  logoUrl?: string | null;
  tree: NavNode[];
  /** 目前網址(已正規化),決定哪一列為選中狀態 */
  currentPath: string;
  /** 模組 key → 該列的待辦數與說明(展開態畫數字、收合態畫小圓點;說明是數字的提示) */
  badges?: NavBadges;
}

export interface SideNavPanelProps extends SideNavContentProps {
  /** `<nav>` 的 id(手機抽屜給,讓主選單鈕以 `aria-controls` 指向它) */
  id?: string;
  /** 收成 64px 圖示列(手機抽屜裡一律展開) */
  isCollapsed: boolean;
  /** 底部收合開關;省略則不顯示(手機抽屜沒有收合) */
  onToggle?: () => void;
  /** 點了任一模組連結時額外要做的事(手機抽屜用來關掉自己) */
  onNavigate?: () => void;
  /** 底部區塊(手機抽屜放說明與頭像選單);和收合開關佔同一個位置 */
  footer?: ReactNode;
}

/**
 * 側欄本體(Figma Draft/AdminSideNav 30:52 / Draft/AdminSideNavCollapsed 246:64):
 * 頂部租戶識別 + 模組樹 + 底部收合開關,**同一個元件的兩種寬度**(240 / 64)。
 * Figma 第一列的「總覽」是模組(key `overview`,seeds/base/modules/overview.ts),和其他模組一樣從 `me.modules` 長出來、受權限過濾,不是固定列。
 * 頂部租戶識別照 Figma 的 ShowLogo 變體:**有商標就顯示商標圖、沒有才顯示組織名稱**(兩者佔同一個位置);
 * 商標是 api 現簽的短效網址(ADR-0010),`alt` 用組織名,讓換成圖之後名稱仍讀得到。
 * 放在殼的左欄(`md` 以上)或抽屜裡(`SideNav` 決定)。
 */
export const SideNavPanel = ({
  orgName,
  logoUrl,
  tree,
  currentPath,
  badges,
  id,
  isCollapsed,
  onToggle,
  onNavigate,
  footer,
}: SideNavPanelProps) => {
  const t = useTranslations("admin.shell");
  const tApp = useTranslations("admin.app");

  return (
    <Box
      component="nav"
      id={id}
      aria-label={t("sideNav")}
      sx={{
        width: (theme) =>
          theme.spacing(isCollapsed ? NAV_COLLAPSED_WIDTH : NAV_WIDTH),
        flexShrink: 0,
        height: "100%",
        // 殼釘死 100vh:側欄自己是 column flex,只有模組樹那一格捲動,底部開關永遠看得到
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.paper",
        borderRight: 1,
        borderColor: "divider",
        px: isCollapsed ? 1.5 : 2,
        py: 3,
      }}
    >
      {isCollapsed ? (
        /* 收合態只留商標圖(Figma 246:65);沒有商標時 Avatar 以組織名首字代替,名稱仍由 alt / title 讀得到 */
        <Box sx={{ display: "flex", justifyContent: "center", mb: 1.5 }}>
          <Avatar
            variant="rounded"
            src={logoUrl ?? undefined}
            alt={orgName}
            sx={{
              width: LOGO_SIZE,
              height: LOGO_SIZE,
              borderRadius: LOGO_RADIUS,
            }}
          >
            {orgName.slice(0, 1)}
          </Avatar>
        </Box>
      ) : (
        <Stack spacing={0.5} sx={{ mb: 1.5 }}>
          {logoUrl === null || logoUrl === undefined ? (
            <Typography variant="h5" color="primary" noWrap>
              {orgName}
            </Typography>
          ) : (
            <Avatar
              variant="rounded"
              src={logoUrl}
              alt={orgName}
              sx={{
                width: LOGO_SIZE,
                height: LOGO_SIZE,
                borderRadius: LOGO_RADIUS,
              }}
            />
          )}
          <Typography variant="caption" color="textSecondary">
            {tApp("subtitle")}
          </Typography>
        </Stack>
      )}

      {/* 模組多到超過視窗時只有這一格垂直捲動(`minHeight: 0` 才拿得到確定的高度,STYLE-08)。
          收合態兩軸都明確設:只寫 `overflow-y: auto` 會連帶把 `overflow-x` 算成 auto,而 64 寬扣掉內距與右邊框
          比圖示格(40)窄 1px,就多出一條水平捲軸;捲軸本身也藏起來(64 寬放不下,滾輪 / 觸控照樣捲) */}
      <Box
        data-testid="side-nav-content"
        sx={
          isCollapsed
            ? {
                flex: 1,
                minHeight: 0,
                overflowX: "hidden",
                overflowY: "auto",
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
              }
            : { flex: 1, minHeight: 0, overflowY: "auto" }
        }
      >
        {isCollapsed ? (
          <NavRail nodes={tree} currentPath={currentPath} badges={badges} />
        ) : (
          <List
            component="div"
            disablePadding
            sx={{ display: "grid", gap: 0.5 }}
          >
            <NavNodes
              nodes={tree}
              currentPath={currentPath}
              badges={badges}
              onNavigate={onNavigate}
            />
          </List>
        )}
      </Box>

      {footer}
      {onToggle !== undefined && (
        <SideNavToggle isCollapsed={isCollapsed} onToggle={onToggle} />
      )}
    </Box>
  );
};
