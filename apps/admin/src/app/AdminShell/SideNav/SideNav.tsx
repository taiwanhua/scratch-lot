import { NavDrawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";

import { useSideNavStore } from "@/stores/base/useSideNavStore";

import { type SideNavContentProps, SideNavPanel } from "./SideNavPanel";

export type SideNavProps = SideNavContentProps;

/**
 * 後台側欄:`sm` 以上是殼的左欄(可收合成 64px 圖示列);手機寬(< `sm`)改放進從左側滑出的抽屜
 * (`@repo/ui/drawer` 的 `NavDrawer`):預設收起,AppBar 左側的主選單鈕打開,點遮罩、按 Esc、點了模組連結就關;
 * 抽屜裡一律展開、沒有收合開關。
 *
 * 收合狀態與抽屜開關都在 `useSideNavStore`(收合存 localStorage、抽屜不存):AppBar / 路由頁籤 / 內容區
 * 是 `ShellLayout` 裡的 `flex: 1` 相鄰格,側欄一改寬度它們自己跟著變(STYLE-08,不必各自知道這件事)。
 */
export const SideNav = (props: SideNavProps) => {
  const isMobile = useBreakpointDown("sm");
  const isCollapsed = useSideNavStore((state) => state.isCollapsed);
  const toggle = useSideNavStore((state) => state.toggle);
  const isMobileOpen = useSideNavStore((state) => state.isMobileOpen);
  const setMobileOpen = useSideNavStore((state) => state.setMobileOpen);

  if (!isMobile) {
    return (
      <SideNavPanel {...props} isCollapsed={isCollapsed} onToggle={toggle} />
    );
  }

  const close = () => {
    setMobileOpen(false);
  };
  return (
    <NavDrawer open={isMobileOpen} onClose={close}>
      <SideNavPanel {...props} isCollapsed={false} onNavigate={close} />
    </NavDrawer>
  );
};
