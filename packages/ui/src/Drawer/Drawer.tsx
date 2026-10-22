"use client";

import MuiDrawer, {
  type DrawerProps as MuiDrawerProps,
} from "@mui/material/Drawer";
import Portal from "@mui/material/Portal";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

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
  /**
   * 預設 true:蓋遮罩、焦點鎖在抽屜裡(MUI `temporary`)。
   * false:**不蓋遮罩、不鎖焦點**的右側抽屜(MUI `persistent`),抽屜外的畫面照樣能看、能點 ——
   * 給「邊看邊改」的用途(例:設計器的屬性面板,改的同時要看得到畫布上選中的那一個)。
   * 這時由本元件補上鍵盤操作:打開時焦點移進抽屜、在抽屜裡按 Esc 呼叫 `onClose`、
   * 關閉時焦點還給打開前的元素。只用在 `anchor="right"`。
   */
  isModal?: boolean;
}

/**
 * 右側抽屜寬(Figma RW-01b 平板 224:1855:360;STYLE-06 直寫)。
 * 匯出給非遮罩抽屜的呼叫端:抽屜開著時要替被蓋住的內容讓出多寬,以它為準。
 */
export const DRAWER_SIDE_WIDTH = 360;
/** 底部抽屜上方的拉把(Figma RW-01b 手機 224:1952:40 × 4)。 */
const HANDLE_WIDTH = 40;
const HANDLE_HEIGHT = 4;

/**
 * 抽屜(Figma RW-01b:平板從右側、手機從底部;底部的可以往上拉成全螢幕 → 這裡以最大高度 100% 呈現)。
 * 版面:標題列(標題 + 關閉)→ 內容(自己捲)→ 動作列。內容與動作的意義由呼叫端決定
 * (admin 的篩選抽屜 `components/base/FilterDrawer` 用它)。
 * `isModal={false}` 是不蓋遮罩的右側抽屜(admin 平板寬的設計器屬性面板用它),見該 prop 的說明。
 */
export const Drawer = ({
  anchor,
  title,
  closeLabel,
  actions,
  onClose,
  children,
  slotProps,
  isModal = true,
  open,
  ...rest
}: DrawerProps) => {
  const isBottom = anchor === "bottom";
  const contentRef = useRef<HTMLDivElement>(null);
  /** 非遮罩抽屜打開前的焦點(關閉時還回去) */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // 非遮罩抽屜沒有 MUI Modal 代管焦點:打開時移進來、關閉時(焦點還在抽屜裡才)還給打開前的元素
  useEffect(() => {
    const content = contentRef.current;
    if (isModal || content === null) {
      return;
    }
    if (open === true) {
      const active = document.activeElement;
      returnFocusRef.current =
        active instanceof HTMLElement && !content.contains(active)
          ? active
          : null;
      content.focus({ preventScroll: true });
      return;
    }
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (content.contains(document.activeElement) && back?.isConnected) {
      back.focus({ preventScroll: true });
    }
  }, [isModal, open]);

  /** 非遮罩抽屜的 Esc(遮罩抽屜由 MUI Modal 處理);抽屜裡的選單、下拉自己處理掉的 Esc 不算 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      isModal ||
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.stopPropagation();
    onClose();
  };

  const drawer = (
    <MuiDrawer
      anchor={anchor}
      open={open}
      onClose={onClose}
      {...(!isModal && { variant: "persistent" as const })}
      slotProps={{
        ...slotProps,
        paper: {
          sx: isBottom
            ? {
                maxHeight: "100%",
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
              }
            : {
                width: DRAWER_SIDE_WIDTH,
                maxWidth: "100%",
                borderTopLeftRadius: radius.lg,
                borderBottomLeftRadius: radius.lg,
                // 非遮罩(persistent)的紙面 MUI 不給陰影,補上與遮罩抽屜相同的層次
                ...(!isModal && { boxShadow: 16 }),
              },
        },
      }}
      {...rest}
    >
      <Stack
        ref={contentRef}
        tabIndex={isModal ? undefined : -1}
        onKeyDown={handleKeyDown}
        sx={{
          height: "100%",
          minHeight: 0,
          px: 2.5,
          pb: 2.5,
          outline: "none",
        }}
      >
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
  // 非遮罩抽屜是就地渲染的(MUI 只替 temporary 開 portal):掛到 body,不佔呼叫端排版的位置(flex 的 gap)
  return isModal ? drawer : <Portal>{drawer}</Portal>;
};
