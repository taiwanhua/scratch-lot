import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { LOCALE_STORAGE_KEY } from "@/lib/base/locale";
import { authWorld } from "@/test/msw/auth-handlers";
import { superAdminModules } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import { LONG_PRESS_MS } from "./useLongPress";

/**
 * 路由頁籤的批次關閉選單:右鍵、觸控長按、列最右「⋯」、鍵盤選單鍵 / Shift+F10 叫出同一份選單;
 * 狀態規則(關哪些、目前頁被關時切到哪)的細節在 `lib/base/route-tabs.test.ts`,這裡驗叫出方式與畫面結果。
 */

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

const location = () => screen.getByTestId("location");

/** 開三個頁籤:總覽、組織管理、使用者管理(目前頁 = 使用者管理)。 */
const openThreeTabs = async () => {
  server.use(
    ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
      .handlers,
  );
  const view = renderApp({ path: "/overview" });
  const list = await findTabList();
  await view.user.click(sideNavLink("組織管理"));
  await view.user.click(sideNavLink("使用者管理"));
  await waitFor(() => {
    expect(tabLabels(list)).toEqual(["總覽", "組織管理", "使用者管理"]);
  });
  return { ...view, list };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

beforeEach(() => {
  sessionStorage.clear();
});

/**
 * jsdom 沒有 `PointerEvent`:`fireEvent.pointerDown` 退回一般 `Event`,`pointerType` / 座標都帶不進去。
 * 測試期間補一個以 `MouseEvent` 為底的替身(座標來自 MouseEvent,`pointerType` 自己帶)。
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "";
  }
}
const originalPointerEvent = Object.getOwnPropertyDescriptor(
  globalThis,
  "PointerEvent",
);
beforeAll(() => {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    writable: true,
    value: TestPointerEvent,
  });
});
afterAll(() => {
  if (originalPointerEvent === undefined) {
    Reflect.deleteProperty(globalThis, "PointerEvent");
  } else {
    Object.defineProperty(globalThis, "PointerEvent", originalPointerEvent);
  }
});

describe("RouteTabs:批次關閉選單", () => {
  it("右鍵叫出選單(role=menu,名稱帶頁籤名);關閉右側 → 目前頁被關,切到按右鍵的那一頁", async () => {
    const { user, list } = await openThreeTabs();

    fireEvent.contextMenu(within(list).getByRole("tab", { name: "組織管理" }), {
      clientX: 120,
      clientY: 40,
    });
    const menu = await screen.findByRole("menu", {
      name: "頁籤選單 — 組織管理",
    });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["關閉左側所有分頁", "關閉右側所有分頁", "關閉其他所有分頁"]);

    await user.click(
      within(menu).getByRole("menuitem", { name: "關閉右側所有分頁" }),
    );
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理"]);
    });
    expect(location()).toHaveTextContent("/system/org-manager");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("目前頁沒被關 → 畫面不動;沒有可關的那一項停用", async () => {
    const { user, list } = await openThreeTabs();

    // 最左的頁籤:關閉左側停用
    fireEvent.contextMenu(within(list).getByRole("tab", { name: "總覽" }), {
      clientX: 20,
      clientY: 40,
    });
    const first = await screen.findByRole("menu");
    expect(
      within(first).getByRole("menuitem", { name: "關閉左側所有分頁" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    // 在目前頁(最右)按右鍵:關閉右側停用;關閉其他 → 只留它,網址不變
    fireEvent.contextMenu(
      within(list).getByRole("tab", { name: "使用者管理" }),
      {
        clientX: 220,
        clientY: 40,
      },
    );
    const last = await screen.findByRole("menu");
    expect(
      within(last).getByRole("menuitem", { name: "關閉右側所有分頁" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.click(
      within(last).getByRole("menuitem", { name: "關閉其他所有分頁" }),
    );
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["使用者管理"]);
    });
    expect(location()).toHaveTextContent("/system/user-manager");

    // 只剩一個:三項全部停用
    fireEvent.contextMenu(
      within(list).getByRole("tab", { name: "使用者管理" }),
      {
        clientX: 20,
        clientY: 40,
      },
    );
    const single = await screen.findByRole("menu");
    for (const item of within(single).getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("列最右的「⋯」作用在目前頁籤:關閉左側後目前頁不動", async () => {
    const { user, list } = await openThreeTabs();
    await user.click(within(list).getByRole("tab", { name: "組織管理" }));
    await waitFor(() => {
      expect(location()).toHaveTextContent("/system/org-manager");
    });

    const more = screen.getByRole("button", { name: "頁籤選單" });
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    await user.click(more);
    const menu = await screen.findByRole("menu", {
      name: "頁籤選單 — 組織管理",
    });
    await user.click(
      within(menu).getByRole("menuitem", { name: "關閉左側所有分頁" }),
    );

    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["組織管理", "使用者管理"]);
    });
    expect(location()).toHaveTextContent("/system/org-manager");
  });

  it("觸控長按約 0.5 秒叫出選單,放開後不切換頁籤;按住時移動超過拖曳門檻就不算長按", async () => {
    const { list } = await openThreeTabs();
    const org = within(list).getByRole("tab", { name: "組織管理" });

    // 按住後拖動 → 交給拖曳,不叫出選單
    fireEvent.pointerDown(org, {
      pointerType: "touch",
      clientX: 100,
      clientY: 40,
    });
    fireEvent.pointerMove(org, {
      pointerType: "touch",
      clientX: 120,
      clientY: 40,
    });
    await sleep(LONG_PRESS_MS + 100);
    fireEvent.pointerUp(org, { pointerType: "touch" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // 按住不動 → 長按
    fireEvent.pointerDown(org, {
      pointerType: "touch",
      clientX: 100,
      clientY: 40,
    });
    expect(
      await screen.findByRole(
        "menu",
        { name: "頁籤選單 — 組織管理" },
        { timeout: LONG_PRESS_MS + 1000 },
      ),
    ).toBeInTheDocument();
    fireEvent.pointerUp(org, { pointerType: "touch" });
    fireEvent.click(org);
    expect(location()).toHaveTextContent("/system/user-manager");
  });

  it("滑鼠按住不放不算長按(滑鼠用右鍵)", async () => {
    const { list } = await openThreeTabs();
    const org = within(list).getByRole("tab", { name: "組織管理" });

    fireEvent.pointerDown(org, {
      pointerType: "mouse",
      clientX: 100,
      clientY: 40,
    });
    await sleep(LONG_PRESS_MS + 100);
    fireEvent.pointerUp(org, { pointerType: "mouse" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("鍵盤:焦點在頁籤時 Shift+F10 或選單鍵叫出選單,Esc 關閉後焦點回到頁籤", async () => {
    const { user, list } = await openThreeTabs();
    const current = within(list).getByRole("tab", { name: "使用者管理" });
    current.focus();

    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu", {
      name: "頁籤選單 — 使用者管理",
    });
    // 選單開著時焦點在選單項目上(方向鍵移動)
    expect(within(menu).getAllByRole("menuitem")).toContain(
      document.activeElement,
    );
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(current).toHaveFocus();
    });

    await user.keyboard("{ContextMenu}");
    expect(
      await screen.findByRole("menu", { name: "頁籤選單 — 使用者管理" }),
    ).toBeInTheDocument();
  });
});

describe("RouteTabs:批次關閉選單的多語", () => {
  afterEach(() => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  });

  it("英文介面的選單文案", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );
    const { user } = renderApp({ path: "/overview" });
    await user.click(await screen.findByRole("button", { name: "小華" }));
    await user.click(screen.getByRole("button", { name: "English" }));
    await user.keyboard("{Escape}");
    const list = await screen.findByRole("tablist", { name: "Route tabs" });

    fireEvent.contextMenu(within(list).getByRole("tab"), {
      clientX: 20,
      clientY: 40,
    });
    const menu = await screen.findByRole("menu", { name: /^Tab menu — / });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Close all tabs to the left",
      "Close all tabs to the right",
      "Close all other tabs",
    ]);
  });
});
