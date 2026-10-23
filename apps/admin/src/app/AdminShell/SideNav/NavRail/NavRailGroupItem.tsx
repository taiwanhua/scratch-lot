import { type MouseEvent, createElement, useState } from "react";

import { Box } from "@repo/ui/box";
import { moduleIconOf } from "@repo/ui/icons";
import { List, ListItemButton } from "@repo/ui/list";
import { Popover } from "@repo/ui/popover";
import { Stack } from "@repo/ui/stack";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import type { NavBadges } from "@/hooks/base/useSidebarBadges";
import type { NavNode } from "@/lib/base/module-tree";

import { NavNodes } from "../NavNodes/NavNodes";
import {
  FLYOUT_WIDTH,
  GROUP_DOT_INSET,
  GROUP_DOT_SIZE,
  railItemSx,
} from "./nav-rail-styles";

export interface NavRailGroupItemProps {
  node: NavNode;
  /** 目前網址(已正規化);交給 flyout 裡的子列判斷選中 */
  currentPath: string;
  /** 目前網址落在這個群組底下(收合後看不到子列,選中狀態改標在群組這一格) */
  isSelected: boolean;
  /** 模組 key → 待辦數與說明;交給 flyout 裡的子列 */
  badges?: NavBadges;
}

/**
 * 收合態的群組列(Figma `Draft/NavRailItem` 246:63 的 Group):群組圖示 + 右上小點,
 * 點擊彈出子選單 flyout(Figma `group-flyout (示意)` 246:99:標題 + `Draft/NavItem` 列)。
 *
 * flyout 裡直接重用展開態的 `NavNodes` —— 子層可能還有群組(示範次群組),
 * 那一層的展開 / 收合行為與展開態完全一樣,不另寫一套。
 */
export const NavRailGroupItem = ({
  node,
  currentPath,
  isSelected,
  badges,
}: NavRailGroupItemProps) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = node.module.name;

  const close = () => {
    setAnchor(null);
  };

  return (
    <>
      {/* 沒有可見文字,提示就是名字(REACT-10 的例外,同 NavRailLinkItem) */}
      <Tooltip title={label} placement="right" describeChild={false}>
        <ListItemButton
          selected={isSelected}
          aria-haspopup="true"
          aria-expanded={anchor !== null}
          onClick={(event: MouseEvent<HTMLElement>) => {
            setAnchor(event.currentTarget);
          }}
          sx={railItemSx}
        >
          {createElement(moduleIconOf(node.module.icon), {
            fontSize: "small",
          })}
          {/* Figma 246:62:右上 6px 小點 = 這一格點開有子選單 */}
          <Box
            sx={{
              position: "absolute",
              top: GROUP_DOT_INSET,
              right: GROUP_DOT_INSET,
              width: GROUP_DOT_SIZE,
              height: GROUP_DOT_SIZE,
              borderRadius: "50%",
              bgcolor: "text.disabled",
            }}
          />
        </ListItemButton>
      </Tooltip>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Stack spacing={1} sx={{ width: FLYOUT_WIDTH, p: 1 }}>
          <Typography
            variant="caption"
            color="textDisabled"
            sx={{ px: 1.5, fontWeight: 600 }}
          >
            {label}
          </Typography>
          <List
            component="div"
            disablePadding
            sx={{ display: "grid", gap: 0.5 }}
          >
            {/* 點到子模組就收起 flyout;點群組標頭只是展開 / 收合那一層,不關 */}
            <NavNodes
              nodes={node.children}
              currentPath={currentPath}
              onNavigate={close}
              badges={badges}
            />
          </List>
        </Stack>
      </Popover>
    </>
  );
};
