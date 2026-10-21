import { useSideNavStore } from "@/stores/base/useSideNavStore";

/**
 * 「側欄是面板收的」記在這個分頁的 sessionStorage:面板開著時重新整理(effect 的還原沒機會跑),
 * 下次進排班表時照這個記號把側欄展開回去,側欄偏好不會被面板汙染。
 */
export const NAV_COLLAPSED_BY_CHECK_KEY = "schedule.roster.check-collapsed-nav";

const readMark = (): boolean => {
  try {
    return sessionStorage.getItem(NAV_COLLAPSED_BY_CHECK_KEY) === "1";
  } catch {
    return false;
  }
};

const writeMark = (collapsed: boolean): void => {
  try {
    if (collapsed) {
      sessionStorage.setItem(NAV_COLLAPSED_BY_CHECK_KEY, "1");
    } else {
      sessionStorage.removeItem(NAV_COLLAPSED_BY_CHECK_KEY);
    }
  } catch {
    // sessionStorage 不可用:只是重新整理後不會自動展開回去
  }
};

/** 上次面板收了側欄、還沒還原就離開(重新整理)→ 展開回去。 */
export const restoreNavFromMark = (): void => {
  if (!readMark()) {
    return;
  }
  writeMark(false);
  const nav = useSideNavStore.getState();
  if (nav.isCollapsed) {
    nav.toggle();
  }
};

/**
 * 面板打開(電腦 / 平板):側欄還展開著就收成圖示列,並留記號;回 true = 這次是面板收的。
 * 本來就收著的不動、不留記號。
 */
export const collapseNavForPanel = (): boolean => {
  const nav = useSideNavStore.getState();
  if (nav.isCollapsed) {
    return false;
  }
  nav.toggle();
  writeMark(true);
  return true;
};

/** 面板關上(或離開頁面):是面板收的才展開回去;清掉記號。 */
export const restoreNavAfterPanel = (collapsedByPanel: boolean): void => {
  if (collapsedByPanel && useSideNavStore.getState().isCollapsed) {
    useSideNavStore.getState().toggle();
  }
  writeMark(false);
};
