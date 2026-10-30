"use client";

import MuiDrawer, {
  type DrawerProps as MuiDrawerProps,
} from "@mui/material/Drawer";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

import { IconButton } from "../IconButton/IconButton";
import { Stack } from "../Stack/Stack";
import { Typography } from "../Typography/Typography";
import { CloseIcon } from "../icons/CloseIcon";
import { mergeSx } from "../theme/sx";
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
   * 關閉時焦點還給打開前的元素;內容是以標題命名的 `region`(`aria-labelledby`)。只用在 `anchor="right"`。
   *
   * 非遮罩抽屜**就地渲染、不開 portal**:Tab 順序跟著它在頁面上的位置走(不會跳到頁尾),
   * 祖先被藏起來(`display: none`,例:切到別的頁籤)時抽屜跟著藏,**不另外搬焦點**:讓它藏起來的操作
   * (點頁籤、開另一個區塊)本身已經把焦點帶到那顆鈕上,抽屜裡不會留著焦點;打開前的元素(畫布上的欄位)
   * 也在同一個被藏起來的區塊裡,還回去反而讓焦點落在看不見的地方。回到原頁籤時抽屜照原樣開著。
   * 紙面是 `position: fixed`,所以祖先不能有 `transform` / `filter`(會把 fixed 的參照換成那個祖先)。外層那個 MUI 容器改成絕對定位,不佔呼叫端排版(flex 的 gap)。
   */
  isModal?: boolean;
  /**
   * 非遮罩抽屜的紙面從視窗頂端往下多少開始(theme.spacing 單位;預設 0 = 貼齊頂端)。
   * 呼叫端有固定的頂部列時給它的高,抽屜就不會蓋住頂部列上的通知、頭像。
   */
  topOffset?: number;
  /**
   * 右側抽屜的寬(px;預設 `DRAWER_SIDE_WIDTH` 360)。內容在 360 放不下時給(例:要並排一個月曆);
   * 視窗比它窄時仍以視窗寬為上限。只用在 `anchor="right"`(底部抽屜一律滿寬)。
   * 非遮罩抽屜的呼叫端替被蓋住的內容讓出空間時,要用同一個值。
   */
  width?: number;
}

/**
 * 右側抽屜的預設寬(Figma RW-01b 平板 224:1855:360;STYLE-06 直寫);個別抽屜可用 `width` 改。
 * 匯出給非遮罩抽屜的呼叫端:沒給 `width` 的抽屜開著時要替被蓋住的內容讓出多寬,以它為準。
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
  topOffset = 0,
  width = DRAWER_SIDE_WIDTH,
  open,
  sx,
  ...rest
}: DrawerProps) => {
  const isBottom = anchor === "bottom";
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
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

  return (
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
                width,
                maxWidth: "100%",
                borderTopLeftRadius: radius.lg,
                borderBottomLeftRadius: radius.lg,
                // 非遮罩(persistent)的紙面 MUI 不給陰影,補上與遮罩抽屜相同的層次;從 `topOffset` 往下撐滿
                ...(!isModal && {
                  boxShadow: 16,
                  top: (theme) => theme.spacing(topOffset),
                  height: (theme) => `calc(100% - ${theme.spacing(topOffset)})`,
                }),
              },
        },
      }}
      // 非遮罩抽屜就地渲染:外層容器不參與呼叫端的排版
      sx={isModal ? sx : mergeSx({ position: "absolute" }, sx)}
      {...rest}
    >
      <Stack
        ref={contentRef}
        tabIndex={isModal ? undefined : -1}
        onKeyDown={handleKeyDown}
        {...(!isModal && { role: "region", "aria-labelledby": titleId })}
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
          <Typography id={titleId} variant="h6" sx={{ flex: 1 }}>
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
