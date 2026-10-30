import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

import { Box } from "@repo/ui/box";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import { Typography } from "@repo/ui/typography";

import {
  DRAG_START_DISTANCE,
  useSortableItem,
} from "@/hooks/base/useSortableItem";
import type { RouteTab } from "@/lib/base/route-tabs";

import type { RouteTabMenuAnchor } from "./RouteTabMenu";
import { useLongPress } from "./useLongPress";

/** 頁籤高 / 關閉圖示(theme.spacing 單位;Figma RouteTab 30 高、close 12)。 */
const TAB_HEIGHT = 3.75;
const CLOSE_ICON_SIZE = 1.5;

export interface SortableTabProps {
  tab: RouteTab;
  isActive: boolean;
  /** 單一 tab stop(WAI-ARIA tabs):選中者 0、其餘 -1;沒有選中者時第一個 0 */
  tabIndex: 0 | -1;
  closeLabel: string;
  onSelect: () => void;
  onClose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** 叫出批次關閉選單(右鍵、觸控長按) */
  onOpenMenu: (anchor: RouteTabMenuAnchor) => void;
}

const stopPointerPropagation = (event: PointerEvent<HTMLButtonElement>) => {
  // 關閉鈕上按下不啟動拖曳
  event.stopPropagation();
};

/**
 * 單一頁籤(Figma Draft/RouteTab 26:48:State=Active 品牌淺色底 + 深色字、Default 底色 + 次要字;Closable 開關 = 關閉鈕)。
 * 整顆 tab 是 dnd-kit 的可拖曳節點(指標;共用 `hooks/base/useSortableItem`);鍵盤排序不走 dnd-kit,由 `RouteTabs` 的 keydown 直接搬(見 keyboardHint)。
 * 右鍵或觸控長按(按住不動約 0.5 秒;一移動就交給拖曳)叫出批次關閉選單;長按放開後補來的那次點擊不切換頁籤。
 */
export const SortableTab = ({
  tab,
  isActive,
  tabIndex,
  closeLabel,
  onSelect,
  onClose,
  onKeyDown,
  onOpenMenu,
}: SortableTabProps) => {
  // 長按移動超過拖曳門檻就取消,交給拖曳
  const longPress = useLongPress(({ x, y }) => {
    onOpenMenu({ top: y, left: x });
  }, DRAG_START_DISTANCE);
  const { attributes, listeners, setNodeRef, isDragging, dragSx } =
    useSortableItem(tab.route);
  // dnd-kit 的指標感測器掛在 onPointerDown;本元件也要接 pointerdown(長按),所以自己串起來。
  // 型別是 `Record<string, Function>`,沒有哪個 key 一定在(換感測器就沒有),照可能不存在處理
  const dndPointerDown = listeners?.onPointerDown as
    ((event: PointerEvent<HTMLDivElement>) => void) | undefined;

  return (
    <Box
      ref={setNodeRef}
      role="tab"
      aria-selected={isActive}
      aria-describedby={attributes["aria-describedby"]}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      {...listeners}
      onClick={() => {
        if (!longPress.consumeLongPress()) {
          onSelect();
        }
      }}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        // 鍵盤的選單鍵也會送 contextmenu(座標 0, 0):改開在頁籤底下
        onOpenMenu(
          event.clientX === 0 && event.clientY === 0
            ? { element: event.currentTarget }
            : { top: event.clientY, left: event.clientX },
        );
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        longPress.onPointerDown(event);
        dndPointerDown?.(event);
      }}
      onPointerMove={longPress.onPointerMove}
      onPointerUp={longPress.onPointerUp}
      onPointerCancel={longPress.onPointerCancel}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        height: (theme) => theme.spacing(TAB_HEIGHT),
        pl: 1.5,
        pr: 1,
        borderRadius: 1,
        flexShrink: 0,
        userSelect: "none",
        // iOS 長按不跳出系統的連結 / 文字選單(長按交給頁籤選單)
        WebkitTouchCallout: "none",
        bgcolor: isActive ? "primary.lighter" : "background.default",
        color: isActive ? "primary.dark" : "text.secondary",
        boxShadow: isDragging ? 2 : 0,
        // 拖曳中的位移、過場、抓取游標(共用 `useSortableItem`)
        ...dragSx,
        "&:hover": { bgcolor: isActive ? "primary.lighter" : "action.hover" },
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: "1px",
        },
      }}
    >
      <Typography variant="subtitle2" component="span" noWrap>
        {tab.label}
      </Typography>
      <IconButton
        size="small"
        tabIndex={-1}
        aria-label={closeLabel}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onPointerDown={stopPointerPropagation}
        sx={{ p: 0.25, color: "inherit" }}
      >
        <CloseIcon
          sx={{
            width: (theme) => theme.spacing(CLOSE_ICON_SIZE),
            height: (theme) => theme.spacing(CLOSE_ICON_SIZE),
          }}
        />
      </IconButton>
    </Box>
  );
};
