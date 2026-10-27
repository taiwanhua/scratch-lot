import { type ReactNode, useEffect, useRef } from "react";

import { NavDrawer } from "@repo/ui/drawer";

import { useSideNavStore } from "@/stores/base/useSideNavStore";

import { useIsShellCompact } from "../shell-geometry";
import { type SideNavContentProps, SideNavPanel } from "./SideNavPanel";

export interface SideNavProps extends SideNavContentProps {
  /** 抽屜底部的區塊(說明「?」與頭像選單;`md` 以上它們在 AppBar) */
  mobileFooter?: ReactNode;
}

/** 抽屜裡側欄的 id(AppBar 主選單鈕的 `aria-controls`)。 */
export const SIDE_NAV_DRAWER_ID = "admin-side-nav-drawer";

/**
 * 後台側欄:`md` 以上是殼的左欄(可收合成 64px 圖示列);精簡版(手機與直拿平板,< `md`,與 AppBar 同一個界線
 * `SHELL_COMPACT_BELOW`)改放進從左側滑出的抽屜
 * (`@repo/ui/drawer` 的 `NavDrawer`):預設收起,AppBar 左側的主選單鈕打開,點遮罩、按 Esc、點了模組連結就關;
 * 抽屜裡一律展開、沒有收合開關;底部放精簡版 AppBar 移走的說明「?」與頭像選單(`mobileFooter`),
 * 從頭像選單去了別的頁(個人設定)也會關。
 *
 * 收合狀態與抽屜開關都在 `useSideNavStore`(收合存 localStorage、抽屜不存):AppBar / 路由頁籤 / 內容區
 * 是 `ShellLayout` 裡的 `flex: 1` 相鄰格,側欄一改寬度它們自己跟著變(STYLE-08,不必各自知道這件事)。
 */
export const SideNav = ({ mobileFooter, ...props }: SideNavProps) => {
  const isCompact = useIsShellCompact();
  const isCollapsed = useSideNavStore((state) => state.isCollapsed);
  const toggle = useSideNavStore((state) => state.toggle);
  const isMobileOpen = useSideNavStore((state) => state.isMobileOpen);
  const setMobileOpen = useSideNavStore((state) => state.setMobileOpen);

  // 抽屜開著時視窗拉寬到 md 以上:收掉,下次回到精簡版仍是收起的
  useEffect(() => {
    if (!isCompact && isMobileOpen) {
      setMobileOpen(false);
    }
  }, [isCompact, isMobileOpen, setMobileOpen]);

  // 網址換了(模組連結以外的入口,例:抽屜底部頭像選單的個人設定)→ 收掉抽屜
  const lastPath = useRef(props.currentPath);
  useEffect(() => {
    if (lastPath.current !== props.currentPath) {
      lastPath.current = props.currentPath;
      setMobileOpen(false);
    }
  }, [props.currentPath, setMobileOpen]);

  if (!isCompact) {
    return (
      <SideNavPanel {...props} isCollapsed={isCollapsed} onToggle={toggle} />
    );
  }

  const close = () => {
    setMobileOpen(false);
  };
  return (
    <NavDrawer open={isMobileOpen} onClose={close}>
      <SideNavPanel
        {...props}
        id={SIDE_NAV_DRAWER_ID}
        isCollapsed={false}
        onNavigate={close}
        footer={mobileFooter}
      />
    </NavDrawer>
  );
};
