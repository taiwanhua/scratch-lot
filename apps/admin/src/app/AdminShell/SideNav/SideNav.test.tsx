import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  SIDE_NAV_STORAGE_KEY,
  useSideNavStore,
} from "@/stores/base/useSideNavStore";
import { authWorld } from "@/test/msw/auth-handlers";
import { superAdminModules } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

/**
 * 側欄收合:64px 圖示列、群組 flyout、狀態記憶,以及展開態改畫模組圖示。
 * 樹的組法與路由導向在 `AdminShell.test.tsx`,這裡只驗收合這條線。
 */

const findSideNav = () => screen.findByRole("navigation", { name: "主選單" });

const renderShell = (path = "/overview") => {
  server.use(
    ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
      .handlers,
  );
  return renderApp({ path });
};

describe("SideNav 收合(Figma Draft/AdminSideNavCollapsed 246:64)", () => {
  it("收合後只剩最上層的圖示列(名稱改由 Tooltip 提供),再按一次回到展開態", async () => {
    const { user } = renderShell();
    const nav = await findSideNav();
    expect(
      within(nav).getByRole("link", { name: "組織管理" }),
    ).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));

    // 群組的子模組收進 flyout,列上只留最上層
    expect(
      within(nav).queryByRole("link", { name: "組織管理" }),
    ).not.toBeInTheDocument();
    const overview = within(nav).getByRole("link", { name: "總覽" });
    expect(overview).toHaveAttribute("aria-current", "page");
    // 沒有可見文字了 —— 名稱來自 Tooltip 的 aria-label(REACT-10 的例外)
    expect(within(nav).queryByText("總覽")).not.toBeInTheDocument();
    expect(
      within(nav).getByRole("button", { name: "系統管理" }),
    ).toHaveAttribute("aria-expanded", "false");

    await user.click(within(nav).getByRole("button", { name: "展開側欄" }));

    expect(
      await within(nav).findByRole("link", { name: "組織管理" }),
    ).toBeInTheDocument();
    expect(within(nav).getByText("總覽")).toBeInTheDocument();
  });

  it("收合狀態記在 localStorage,重新整理後一開始就是圖示列", async () => {
    const { user, unmount } = renderShell();
    const nav = await findSideNav();

    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));
    const stored = localStorage.getItem(SIDE_NAV_STORAGE_KEY) ?? "";
    expect(stored).toContain('"isCollapsed":true');

    /*
     * 模擬重新整理:store 是模組層單例,只能把記憶體歸零再從 localStorage 取回一次。
     * `setState` 會經過 persist 順手把 storage 也寫成新值,所以歸零之後要把剛剛存下來的
     * 內容放回去,`rehydrate()` 讀到的才是「關掉分頁前」的那一筆。
     */
    unmount();
    useSideNavStore.setState({ isCollapsed: false });
    localStorage.setItem(SIDE_NAV_STORAGE_KEY, stored);
    await useSideNavStore.persist.rehydrate();
    expect(useSideNavStore.getState().isCollapsed).toBe(true);

    renderShell();
    const reopened = await findSideNav();
    expect(
      within(reopened).getByRole("button", { name: "展開側欄" }),
    ).toBeInTheDocument();
    expect(within(reopened).queryByText("總覽")).not.toBeInTheDocument();
  });

  it("收合後點群組列彈出子選單(Figma group-flyout 246:99);點子模組導向並收起", async () => {
    const { user } = renderShell();
    const nav = await findSideNav();
    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));

    const group = within(nav).getByRole("button", { name: "示範群組" });
    await user.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");

    // flyout 是 portal 出去的,收合後的側欄裡沒有這條連結,所以全域查得到的只有它;
    // 子層還有一個群組(示範次群組),那一層的展開 / 收合沿用展開態的 NavNodes
    expect(
      await screen.findByRole("button", { name: "示範次群組" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "示範模組2" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/demo/sample-two",
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: "示範模組2" }),
      ).not.toBeInTheDocument();
    });
  });

  it("圖示來自 modules.icon:展開態的 icon-slot 與收合態的圖示列都畫白名單的那一個", async () => {
    const { user } = renderShell();
    const nav = await findSideNav();

    // MUI 的圖示在非 production 會帶 `data-testid` = 元件名(白名單 dashboard → DashboardOutlined)
    expect(
      within(within(nav).getByRole("link", { name: "總覽" })).getByTestId(
        "DashboardOutlinedIcon",
      ),
    ).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "收合側欄" }));

    expect(
      within(within(nav).getByRole("link", { name: "總覽" })).getByTestId(
        "DashboardOutlinedIcon",
      ),
    ).toBeInTheDocument();
    expect(
      within(within(nav).getByRole("button", { name: "系統管理" })).getByTestId(
        "SettingsOutlinedIcon",
      ),
    ).toBeInTheDocument();
  });
});

describe("手機寬(< sm)側欄改成抽屜", () => {
  restoreViewportAfterEach();
  beforeEach(() => {
    useSideNavStore.setState({ isMobileOpen: false, isCollapsed: false });
  });

  it("預設收起;AppBar 的主選單鈕打開,點了模組連結導向並自動關閉", async () => {
    setMobileViewport();
    const { user } = renderShell();
    const open = await screen.findByRole("button", { name: "開啟主選單" });
    expect(
      screen.queryByRole("navigation", { name: "主選單" }),
    ).not.toBeInTheDocument();
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveAttribute("aria-controls", "admin-side-nav-drawer");

    await user.click(open);
    const nav = await findSideNav();
    // 主選單鈕指向抽屜裡的側欄
    expect(nav).toHaveAttribute("id", "admin-side-nav-drawer");
    expect(open).toHaveAttribute("aria-expanded", "true");
    // 抽屜裡一律展開、沒有收合開關
    expect(
      within(nav).queryByRole("button", { name: "收合側欄" }),
    ).not.toBeInTheDocument();

    await user.click(within(nav).getByRole("link", { name: "組織管理" }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/system/org-manager",
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "主選單" }),
      ).not.toBeInTheDocument();
    });
  });

  it("點群組列只展開子項、不關抽屜;按 Esc 關閉", async () => {
    setMobileViewport();
    const { user } = renderShell();
    await user.click(await screen.findByRole("button", { name: "開啟主選單" }));
    const nav = await findSideNav();

    await user.click(within(nav).getByRole("button", { name: "示範群組" }));
    expect(
      screen.getByRole("navigation", { name: "主選單" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "主選單" }),
      ).not.toBeInTheDocument();
    });
  });

  it("點遮罩關閉;關閉後焦點回到主選單鈕", async () => {
    setMobileViewport();
    const { user } = renderShell();
    const open = await screen.findByRole("button", { name: "開啟主選單" });
    await user.click(open);
    await findSideNav();

    const backdrop = document.querySelector(".MuiBackdrop-root");
    expect(backdrop).not.toBeNull();
    if (backdrop !== null) {
      await user.click(backdrop);
    }
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "主選單" }),
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(open).toHaveFocus();
    });
  });

  it("抽屜開著時切到 sm 以上:開關重設為收起(之後回到手機寬不會自己打開)", async () => {
    useSideNavStore.setState({ isMobileOpen: true });
    renderShell();
    await findSideNav();
    await waitFor(() => {
      expect(useSideNavStore.getState().isMobileOpen).toBe(false);
    });
  });

  it("sm 以上沒有主選單鈕,側欄常駐", async () => {
    renderShell();
    await findSideNav();
    expect(
      screen.queryByRole("button", { name: "開啟主選單" }),
    ).not.toBeInTheDocument();
  });
});
