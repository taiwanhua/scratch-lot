import { afterEach, describe, expect, it } from "@jest/globals";

import { useSideNavStore } from "@/stores/base/useSideNavStore";

import {
  NAV_COLLAPSED_BY_CHECK_KEY,
  collapseNavForPanel,
  restoreNavAfterPanel,
  restoreNavFromMark,
} from "./side-nav-mark";

afterEach(() => {
  sessionStorage.clear();
  useSideNavStore.setState({ isCollapsed: false });
});

const isCollapsed = () => useSideNavStore.getState().isCollapsed;
const mark = () => sessionStorage.getItem(NAV_COLLAPSED_BY_CHECK_KEY);

/** 檢核面板與側欄:面板收的才還原、重新整理後也還原,側欄偏好不被汙染。 */
describe("side-nav-mark", () => {
  it("側欄展開著 → 面板收起並留記號;關上面板展開回去、清掉記號", () => {
    expect(collapseNavForPanel()).toBe(true);
    expect(isCollapsed()).toBe(true);
    expect(mark()).toBe("1");
    restoreNavAfterPanel(true);
    expect(isCollapsed()).toBe(false);
    expect(mark()).toBeNull();
  });

  it("本來就收著的側欄不動、不留記號;關上面板也不展開", () => {
    useSideNavStore.setState({ isCollapsed: true });
    expect(collapseNavForPanel()).toBe(false);
    expect(mark()).toBeNull();
    restoreNavAfterPanel(false);
    expect(isCollapsed()).toBe(true);
  });

  it("面板開著就重新整理(沒還原)→ 下次進頁面照記號展開回去", () => {
    collapseNavForPanel();
    // 重新整理:effect 的還原沒跑到,只剩收合的側欄與記號
    restoreNavFromMark();
    expect(isCollapsed()).toBe(false);
    expect(mark()).toBeNull();
  });

  it("沒有記號 → 進頁面不動側欄(使用者自己收的照舊)", () => {
    useSideNavStore.setState({ isCollapsed: true });
    restoreNavFromMark();
    expect(isCollapsed()).toBe(true);
  });
});
