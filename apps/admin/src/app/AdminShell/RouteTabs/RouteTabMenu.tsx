import { useTranslations } from "use-intl";

import { Menu, MenuItem } from "@repo/ui/menu";

import type { BatchCloseKind, RouteTab } from "@/lib/base/route-tabs";

/** 選單開在哪:頁籤 / 「⋯」按鈕底下(鍵盤、按鈕),或指標的位置(右鍵、長按)。 */
export type RouteTabMenuAnchor =
  { element: HTMLElement } | { top: number; left: number };

export interface RouteTabMenuTarget {
  /** 作用的那一頁(按右鍵 / 長按的頁籤;「⋯」是目前頁籤) */
  route: string;
  anchor: RouteTabMenuAnchor;
  /** 由頁籤列最右的「⋯」叫出(那顆按鈕據此標 `aria-expanded`) */
  isFromMoreButton?: boolean;
}

export interface RouteTabMenuProps {
  /** 選單清單的 id(「⋯」按鈕的 `aria-controls`) */
  id: string;
  tabs: RouteTab[];
  /** null = 選單關著 */
  target: RouteTabMenuTarget | null;
  onDismiss: () => void;
  onCloseBatch: (kind: BatchCloseKind, route: string) => void;
}

const ITEMS = [
  { kind: "left", labelKey: "menu.closeLeft" },
  { kind: "right", labelKey: "menu.closeRight" },
  { kind: "others", labelKey: "menu.closeOthers" },
] as const;

/**
 * 路由頁籤的批次關閉選單(右鍵、觸控長按、頁籤列最右「⋯」、鍵盤選單鍵 / Shift+F10 共用這一份):
 * 關閉左側 / 右側 / 其他所有分頁;沒有可關的那一項停用。選了就關選單,焦點由選單還給叫出它的元素。
 */
export const RouteTabMenu = ({
  id,
  tabs,
  target,
  onDismiss,
  onCloseBatch,
}: RouteTabMenuProps) => {
  const t = useTranslations("admin.shell.tabs");
  if (target === null) {
    return null;
  }
  const index = tabs.findIndex((tab) => tab.route === target.route);
  const tab = tabs.at(index);
  if (index === -1 || tab === undefined) {
    return null;
  }
  const isDisabled: Record<BatchCloseKind, boolean> = {
    left: index === 0,
    right: index === tabs.length - 1,
    others: tabs.length <= 1,
  };
  const { anchor } = target;

  return (
    <Menu
      open
      onClose={onDismiss}
      // 鍵盤的選單鍵 / Shift+F10:我們在 keydown 就開了選單,Windows 的瀏覽器在放開按鍵時才送 contextmenu,
      // 那時焦點已在選單項目上;不擋的話瀏覽器原生選單會疊在上面
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      {...("element" in anchor
        ? { anchorEl: anchor.element }
        : {
            anchorReference: "anchorPosition",
            anchorPosition: { top: anchor.top, left: anchor.left },
          })}
      slotProps={{
        list: { id, "aria-label": t("menu.label", { label: tab.label }) },
      }}
    >
      {ITEMS.map(({ kind, labelKey }) => (
        <MenuItem
          key={kind}
          disabled={isDisabled[kind]}
          onClick={() => {
            onDismiss();
            onCloseBatch(kind, target.route);
          }}
        >
          {t(labelKey)}
        </MenuItem>
      ))}
    </Menu>
  );
};
