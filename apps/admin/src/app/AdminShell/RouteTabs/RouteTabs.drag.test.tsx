import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  dndKitCoreDouble,
  dndKitSortableDouble,
  dragEnd,
  dragStart,
} from "@/test/dnd-kit-double";
import { authWorld } from "@/test/msw/auth-handlers";
import { superAdminModules } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { setupPointerEvent } from "@/test/pointer-event";

// dnd-kit 換成測試替身(jsdom 沒有版面幾何);受測 app 必須在替身掛上之後才載入
jest.unstable_mockModule("@dnd-kit/core", () => dndKitCoreDouble);
jest.unstable_mockModule("@dnd-kit/sortable", () => dndKitSortableDouble);
const { renderApp } = await import("@/test/render");
const { routeTabsStorageKey } = await import("@/lib/base/route-tabs");

const tabLabels = (list: HTMLElement) =>
  within(list)
    .queryAllByRole("tab")
    .map((tab) => tab.textContent);

const sideNavLink = (name: string) =>
  within(screen.getByRole("navigation", { name: "主選單" })).getByRole("link", {
    name,
  });

beforeEach(() => {
  sessionStorage.clear();
});

setupPointerEvent();

describe("RouteTabs:拖曳排序(dnd-kit 測試替身)", () => {
  it("拖曳後順序保持,並寫進 sessionStorage;拖到原位或放空不動", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    const { user } = renderApp({ path: "/overview" });
    const list = await screen.findByRole("tablist", { name: "路由頁籤" });
    await user.click(sideNavLink("組織管理"));
    await user.click(sideNavLink("使用者管理"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理", "使用者管理"]);
    });

    dragEnd("/overview", "/system/user-manager");
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["組織管理", "使用者管理", "總覽"]);
    });
    // 排序不改變當前頁
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/system/user-manager",
    );
    expect(
      JSON.parse(sessionStorage.getItem(routeTabsStorageKey("user-1")) ?? "[]"),
    ).toEqual([
      { route: "/system/org-manager" },
      { route: "/system/user-manager" },
      { route: "/overview" },
    ]);

    dragEnd("/overview", "/overview");
    dragEnd("/overview", null);
    expect(tabLabels(list)).toEqual(["組織管理", "使用者管理", "總覽"]);
  });
});

describe("RouteTabs:長按選單與拖曳不同時存在", () => {
  it("長按叫出選單後手指再拖動(拖曳啟動)→ 選單關閉", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    const { user } = renderApp({ path: "/overview" });
    const list = await screen.findByRole("tablist", { name: "路由頁籤" });
    await user.click(sideNavLink("組織管理"));
    const org = await within(list).findByRole("tab", { name: "組織管理" });

    fireEvent.pointerDown(org, {
      pointerType: "touch",
      clientX: 100,
      clientY: 40,
    });
    expect(
      await screen.findByRole(
        "menu",
        { name: "頁籤選單 — 組織管理" },
        { timeout: 1500 },
      ),
    ).toBeInTheDocument();

    dragStart("/system/org-manager");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
