import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { type KeyboardEvent, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { IconButton } from "@repo/ui/icon-button";
import { MoreHorizIcon } from "@repo/ui/icons";

import type { BatchCloseKind, RouteTab } from "@/lib/base/route-tabs";

import {
  RouteTabMenu,
  type RouteTabMenuAnchor,
  type RouteTabMenuTarget,
} from "./RouteTabMenu";
import { SortableTab } from "./SortableTab";

/** 頁籤列高(theme.spacing 單位;Figma AdminRouteTabs 46 高)。 */
const BAR_HEIGHT = 5.75;
/** 指標移動超過這個距離才算拖曳(px;之內是點擊 → 切換頁籤) */
const DRAG_START_DISTANCE = 6;

export interface RouteTabsProps {
  tabs: RouteTab[];
  /** 目前選中的 tab 路由;null = 沒有 tab 選中(網址不是模組路由) */
  activeRoute: string | null;
  onSelect: (route: string) => void;
  onClose: (route: string) => void;
  /** 批次關閉(頁籤選單):`route` 左側 / 右側 / 以外的頁籤 */
  onCloseBatch: (kind: BatchCloseKind, route: string) => void;
  /** 把 `fromRoute` 的 tab 移到 `toRoute` 的位置 */
  onMove: (fromRoute: string, toRoute: string) => void;
}

/**
 * 路由頁籤列(Figma Draft/AdminRouteTabs 34:33):開過的模組路由各一個 tab(狀態在 `useRouteTabs`),
 * 點 tab 切換路由、可關閉、可拖曳排序(dnd-kit sortable,指標)。
 * 鍵盤:左右方向鍵移動焦點(單一 tab stop)、Enter / Space 開啟、Shift+方向鍵調整順序、Delete / Backspace 關閉、
 * 選單鍵 / Shift+F10 叫出頁籤選單;說明文字經 dnd-kit 的隱藏說明節點(`aria-describedby`)提供給輔助科技,拖曳過程以 `announcements` 播報。
 * 頁籤選單(`RouteTabMenu`:關閉左側 / 右側 / 其他所有分頁)也由右鍵、觸控長按與列最右的「⋯」(作用在目前頁籤)叫出。
 */
export const RouteTabs = ({
  tabs,
  activeRoute,
  onSelect,
  onClose,
  onCloseBatch,
  onMove,
}: RouteTabsProps) => {
  const t = useTranslations("admin.shell.tabs");
  const listRef = useRef<HTMLDivElement>(null);
  const [menuTarget, setMenuTarget] = useState<RouteTabMenuTarget | null>(null);
  const openMenu = (route: string, anchor: RouteTabMenuAnchor) => {
    setMenuTarget({ route, anchor });
  };
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_START_DISTANCE },
    }),
  );

  const labelOf = (id: UniqueIdentifier) =>
    tabs.find((tab) => tab.route === id)?.label ?? String(id);

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dragStart", { label: labelOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("dragOver", { label: labelOf(active.id), over: labelOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t("dragEnd", { label: labelOf(active.id), over: labelOf(over.id) })
        : t("dragEndNoTarget", { label: labelOf(active.id) }),
    onDragCancel: ({ active }) =>
      t("dragCancel", { label: labelOf(active.id) }),
  };
  const screenReaderInstructions: ScreenReaderInstructions = {
    draggable: t("keyboardHint"),
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      onMove(String(active.id), String(over.id));
    }
  };

  const focusTab = (index: number) => {
    const items =
      listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    items?.[index]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
  ) => {
    const tab = tabs.at(index);
    if (tab === undefined) {
      return;
    }
    const last = tabs.length - 1;
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      event.preventDefault();
      openMenu(tab.route, { element: event.currentTarget });
      return;
    }
    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const targetIndex = index + step;
        const target = targetIndex < 0 ? undefined : tabs.at(targetIndex);
        if (target === undefined) {
          return;
        }
        if (event.shiftKey) {
          onMove(tab.route, target.route);
        } else {
          focusTab(targetIndex);
        }
        return;
      }
      case "Home": {
        event.preventDefault();
        focusTab(0);
        return;
      }
      case "End": {
        event.preventDefault();
        focusTab(last);
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        onSelect(tab.route);
        return;
      }
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        onClose(tab.route);
        // 被關掉的節點會消失,焦點留在頁籤列(右邊優先,沒有就左邊);等 React 提交後再移
        const nextIndex = Math.min(index, last - 1);
        setTimeout(() => {
          focusTab(nextIndex);
        }, 0);
        return;
      }
      default:
      // 其他按鍵交給瀏覽器
    }
  };

  const activeTab = tabs.find((tab) => tab.route === activeRoute);
  const hasActive = activeTab !== undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      <SortableContext
        items={tabs.map((tab) => tab.route)}
        strategy={horizontalListSortingStrategy}
      >
        {/* 外框是一列:頁籤自己橫向捲動,「⋯」固定在最右、不跟著捲 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            minHeight: (theme) => theme.spacing(BAR_HEIGHT),
            pl: 3,
            pr: 1,
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box
            ref={listRef}
            role="tablist"
            aria-label={t("label")}
            aria-orientation="horizontal"
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 1,
              py: 1,
              overflowX: "auto",
            }}
          >
            {tabs.map((tab, index) => {
              const isActive = tab.route === activeRoute;
              const isTabStop = hasActive ? isActive : index === 0;
              return (
                <SortableTab
                  key={tab.route}
                  tab={tab}
                  isActive={isActive}
                  tabIndex={isTabStop ? 0 : -1}
                  closeLabel={t("close", { label: tab.label })}
                  dragStartDistance={DRAG_START_DISTANCE}
                  onSelect={() => {
                    onSelect(tab.route);
                  }}
                  onClose={() => {
                    onClose(tab.route);
                  }}
                  onKeyDown={(event) => {
                    handleKeyDown(event, index);
                  }}
                  onOpenMenu={(anchor) => {
                    openMenu(tab.route, anchor);
                  }}
                />
              );
            })}
          </Box>
          <IconButton
            size="small"
            aria-label={t("menu.open")}
            aria-haspopup="menu"
            disabled={activeTab === undefined}
            onClick={(event) => {
              if (activeTab !== undefined) {
                openMenu(activeTab.route, { element: event.currentTarget });
              }
            }}
          >
            <MoreHorizIcon fontSize="small" />
          </IconButton>
        </Box>
      </SortableContext>
      <RouteTabMenu
        tabs={tabs}
        target={menuTarget}
        onDismiss={() => {
          setMenuTarget(null);
        }}
        onCloseBatch={onCloseBatch}
      />
    </DndContext>
  );
};
