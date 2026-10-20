"use client";

import MuiDrawer, {
  type DrawerProps as MuiDrawerProps,
} from "@mui/material/Drawer";
import type { ReactNode } from "react";

import { IconButton } from "../IconButton/IconButton";
import { Stack } from "../Stack/Stack";
import { Typography } from "../Typography/Typography";
import { CloseIcon } from "../icons/CloseIcon";
import { radius } from "../theme/tokens";

export interface DrawerProps extends Omit<MuiDrawerProps, "title" | "anchor"> {
  /** 從哪一側滑出:`right`(平板)/ `bottom`(手機,上方有拉把) */
  anchor: "right" | "bottom";
  /** 標題(標題列左側;右側固定一顆關閉鈕) */
  title: ReactNode;
  /** 關閉鈕的無障礙名稱 */
  closeLabel: string;
  /** 底部動作列(例:[清除] … [套用]);省略則不渲染 */
  actions?: ReactNode;
  onClose: () => void;
}

/** 右側抽屜寬(Figma RW-01b 平板 224:1855:360)。只有這個元件用到,依 STYLE-06 直寫。 */
const SIDE_WIDTH = 360;
/** 底部抽屜上方的拉把(Figma RW-01b 手機 224:1952:40 × 4)。 */
const HANDLE_WIDTH = 40;
const HANDLE_HEIGHT = 4;

/**
 * 抽屜(Figma RW-01b:平板從右側、手機從底部;底部的可以往上拉成全螢幕 → 這裡以最大高度 100% 呈現)。
 * 版面:標題列(標題 + 關閉)→ 內容(自己捲)→ 動作列。內容與動作的意義由呼叫端決定
 * (admin 的篩選抽屜 `components/base/FilterDrawer` 用它)。
 */
export const Drawer = ({
  anchor,
  title,
  closeLabel,
  actions,
  onClose,
  children,
  slotProps,
  ...rest
}: DrawerProps) => {
  const isBottom = anchor === "bottom";
  return (
    <MuiDrawer
      anchor={anchor}
      onClose={onClose}
      slotProps={{
        ...slotProps,
        paper: {
          sx: isBottom
            ? {
                maxHeight: "100%",
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
              }
            : { width: SIDE_WIDTH, maxWidth: "100%" },
        },
      }}
      {...rest}
    >
      <Stack sx={{ height: "100%", minHeight: 0, px: 2.5, pb: 2.5 }}>
        {isBottom && (
          <Stack
            aria-hidden
            sx={{
              alignSelf: "center",
              width: HANDLE_WIDTH,
              height: HANDLE_HEIGHT,
              mt: 1.5,
              borderRadius: radius.sm,
              bgcolor: "divider",
            }}
          />
        )}
        <Stack
          direction="row"
          sx={{ alignItems: "center", pt: isBottom ? 1.5 : 2.5, pb: 1.5 }}
        >
          <Typography variant="h6" sx={{ flex: 1 }}>
            {title}
          </Typography>
          <IconButton aria-label={closeLabel} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Stack sx={{ flex: 1, minHeight: 0, overflow: "auto", pt: 1 }}>
          {children}
        </Stack>
        {actions === undefined ? null : (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              pt: 2.5,
            }}
          >
            {actions}
          </Stack>
        )}
      </Stack>
    </MuiDrawer>
  );
};
