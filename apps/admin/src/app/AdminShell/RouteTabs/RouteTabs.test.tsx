import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { routeTabsStorageKey } from "@/lib/base/route-tabs";
import { authWorld, overviewModule, testUser } from "@/test/msw/auth-handlers";
import {
  sampleTwoModules,
  superAdminModules,
} from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

const STORAGE_KEY = routeTabsStorageKey(testUser.id);

const findTabList = async () =>
  screen.findByRole("tablist", { name: "路由頁籤" });

const tabLabels = (list: HTMLElement) =>
  within(list)
    .queryAllByRole("tab")
    .map((tab) => tab.textContent);

const sideNavLink = (name: string) =>
  within(screen.getByRole("navigation", { name: "主選單" })).getByRole("link", {
    name,
  });

const useSuperAdmin = () => {
  server.use(
    ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
      .handlers,
  );
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("RouteTabs:生成與去重(開過的路由生成 tab、以路由去重)", () => {
  it("進入兩個模組路由 → 兩個 tab;重複進入不重複生成;當前 tab 為選中", async () => {
    useSuperAdmin();
    const { user } = renderApp({ path: "/overview" });
    const list = await findTabList();
    expect(tabLabels(list)).toEqual(["總覽"]);

    await user.click(sideNavLink("組織管理"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理"]);
    });
    expect(within(list).getByRole("tab", { name: "組織管理" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(sideNavLink("總覽"));
    await waitFor(() => {
      expect(within(list).getByRole("tab", { name: "總覽" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(tabLabels(list)).toEqual(["總覽", "組織管理"]);
  });

  it("`/` 與群組路由(轉向前)不生成 tab,只有落地的模組路由有", async () => {
    useSuperAdmin();
    renderApp({ path: "/system" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/system/org-manager",
      );
    });
    expect(tabLabels(await findTabList())).toEqual(["組織管理"]);
  });

  it("無權限頁不生成 tab、也沒有選中的 tab", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );
    renderApp({ path: "/system/org-manager" });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(tabLabels(await findTabList())).toEqual([]);
  });

  it("點 tab 切換:內容區與網址同步、AppBar 標題同步", async () => {
    useSuperAdmin();
    const { user } = renderApp({ path: "/overview" });
    const list = await findTabList();
    // 「內容區換了」以殼的 AppBar 標題為準(各頁的版型不一,不是每一頁都有同名標題)
    await user.click(sideNavLink("示範模組2"));
    await waitFor(() => {
      expect(screen.getByRole("banner")).toHaveTextContent("示範模組2");
    });

    await user.click(within(list).getByRole("tab", { name: "總覽" }));

    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    expect(screen.getByRole("banner")).toHaveTextContent("總覽");
    expect(within(list).getByRole("tab", { name: "總覽" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("RouteTabs:關閉", () => {
  it("關閉非當前 tab:當前頁與網址不變", async () => {
    useSuperAdmin();
    const { user } = renderApp({ path: "/overview" });
    const list = await findTabList();
    await user.click(sideNavLink("示範模組2"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "示範模組2"]);
    });

    await user.click(within(list).getByRole("button", { name: "關閉 總覽" }));

    expect(tabLabels(list)).toEqual(["示範模組2"]);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/demo/sample-two",
    );
    expect(screen.getByRole("banner")).toHaveTextContent("示範模組2");
  });

  it("關閉當前 tab → 切到相鄰:右邊優先,最右邊則切左邊", async () => {
    useSuperAdmin();
    const { user } = renderApp({ path: "/overview" });
    const list = await findTabList();
    await user.click(sideNavLink("組織管理"));
    await user.click(sideNavLink("使用者管理"));
    await user.click(sideNavLink("組織管理"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理", "使用者管理"]);
    });

    await user.click(
      within(list).getByRole("button", { name: "關閉 組織管理" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/system/user-manager",
      );
    });
    expect(tabLabels(list)).toEqual(["總覽", "使用者管理"]);
    expect(
      within(list).getByRole("tab", { name: "使用者管理" }),
    ).toHaveAttribute("aria-selected", "true");

    await user.click(
      within(list).getByRole("button", { name: "關閉 使用者管理" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    });
    expect(tabLabels(list)).toEqual(["總覽"]);
  });

  it("全部關閉 → 回 `/`,由既有規則轉到側欄第一個能進的頁並重新生成該 tab", async () => {
    useSuperAdmin();
    const { user } = renderApp({ path: "/system/org-manager" });
    const list = await findTabList();
    expect(tabLabels(list)).toEqual(["組織管理"]);

    await user.click(
      within(list).getByRole("button", { name: "關閉 組織管理" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    });
    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    expect(tabLabels(list)).toEqual(["總覽"]);
  });
});

describe("RouteTabs:重新整理後保留(sessionStorage,以使用者分 key)", () => {
  it("同一分頁重新載入:tabs 與順序保留;已無權限的路由被剔除", async () => {
    useSuperAdmin();
    const first = renderApp({ path: "/overview" });
    const list = await findTabList();
    await first.user.click(sideNavLink("組織管理"));
    await first.user.click(sideNavLink("示範模組2"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理", "示範模組2"]);
    });
    expect(sessionStorage.getItem(STORAGE_KEY)).toContain("/demo/sample-two");
    first.unmount();

    renderApp({ path: "/demo/sample-two" });
    await waitFor(() => {
      expect(tabLabels(screen.getByRole("tablist"))).toEqual([
        "總覽",
        "組織管理",
        "示範模組2",
      ]);
    });
    screen.getByRole("tablist").remove();
    server.resetHandlers();

    // 角色改了:失去系統管理 → 重新載入後「組織管理」tab 消失,其餘保留
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: [overviewModule, ...sampleTwoModules],
      }).handlers,
    );
    renderApp({ path: "/demo/sample-two" });
    await waitFor(() => {
      expect(tabLabels(screen.getByRole("tablist"))).toEqual([
        "總覽",
        "示範模組2",
      ]);
    });
  });
});

describe("RouteTabs:鍵盤(單一 tab stop;jsx-a11y)", () => {
  it("方向鍵移動焦點、Enter 開啟、Shift+方向鍵調整順序、Delete 關閉並把焦點留在頁籤列", async () => {
    useSuperAdmin();
    const { user } = renderApp({ path: "/overview" });
    const list = await findTabList();
    await user.click(sideNavLink("組織管理"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理"]);
    });
    const overviewTab = within(list).getByRole("tab", { name: "總覽" });
    const orgTab = within(list).getByRole("tab", { name: "組織管理" });
    expect(orgTab).toHaveAttribute("tabindex", "0");
    expect(overviewTab).toHaveAttribute("tabindex", "-1");

    // 只有一個 tab stop:從側欄 Tab 過來會落在選中的 tab
    await user.click(orgTab);
    expect(orgTab).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(overviewTab).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    });
    expect(overviewTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["組織管理", "總覽"]);
    });
    expect(overviewTab).toHaveFocus();

    await user.keyboard("{Delete}");
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["組織管理"]);
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/system/org-manager",
    );
    await waitFor(() => {
      expect(orgTab).toHaveFocus();
    });
  });
});
