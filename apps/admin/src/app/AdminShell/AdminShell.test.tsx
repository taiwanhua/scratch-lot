import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { COLOR_MODE_STORAGE_KEY } from "@/lib/base/color-mode";
import { LOCALE_STORAGE_KEY } from "@/lib/base/locale";
import { RealtimeConnection } from "@/lib/base/realtime/realtime-connection";
import {
  SWITCHED_ACCESS_TOKEN,
  authWorld,
  overviewModule,
  testOrg,
} from "@/test/msw/auth-handlers";
import {
  placeholderModules,
  sampleTwoModules,
  superAdminModules,
} from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

const findSideNav = async () =>
  screen.findByRole("navigation", { name: "主選單" });

describe("SideNav(模組陣列以 parentId 組樹;ADR-0011「前端判斷 / 側欄」)", () => {
  it("超級管理員:總覽 + 系統管理群組六項 + 示範群組(含次群組),依 order 排序,hidden 模組不出現", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );

    renderApp({ path: "/overview" });
    const nav = await findSideNav();

    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "總覽",
      "組織管理",
      "使用者管理",
      "角色管理",
      "模組與權限",
      "欄位管理",
      "資料範圍",
      "示範模組1",
      "示範模組2",
    ]);
    expect(
      within(nav).getByRole("button", { name: "系統管理" }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("button", { name: "示範次群組" }),
    ).toBeInTheDocument();
    expect(within(nav).queryByText("編輯示範項目")).not.toBeInTheDocument();
    expect(within(nav).queryByText("API 能力")).not.toBeInTheDocument();
  });

  it("只綁示範模組2 的角色:只看到示範群組,沒有系統管理、也沒有總覽(總覽是模組,受權限過濾)", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );

    renderApp({ path: "/demo/sample-two" });
    const nav = await findSideNav();

    expect(within(nav).getByText("示範模組2")).toBeInTheDocument();
    expect(within(nav).queryByText("系統管理")).not.toBeInTheDocument();
    expect(within(nav).queryByText("組織管理")).not.toBeInTheDocument();
    expect(within(nav).queryByText("總覽")).not.toBeInTheDocument();
  });

  it("群組可收合再展開", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );

    const { user } = renderApp({ path: "/demo/sample-two" });
    const nav = await findSideNav();
    const group = within(nav).getByRole("button", { name: "示範群組" });
    expect(group).toHaveAttribute("aria-expanded", "true");

    await user.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(within(nav).queryByText("示範模組2")).not.toBeInTheDocument();
    });

    await user.click(group);
    expect(await within(nav).findByText("示範模組2")).toBeInTheDocument();
  });

  it("當前組織沒有商標時頂部顯示組織名稱", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/" });
    const nav = await findSideNav();

    expect(within(nav).getByText("平台根組織")).toBeInTheDocument();
    expect(within(nav).queryByRole("img")).not.toBeInTheDocument();
  });

  it("當前組織有商標時頂部改顯示商標圖,alt 為組織名", async () => {
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        currentOrgLogoUrl: "https://cdn.test/org-1.png",
      }).handlers,
    );

    renderApp({ path: "/" });
    const nav = await findSideNav();

    const logo = await within(nav).findByRole("img", { name: "平台根組織" });
    expect(logo).toHaveAttribute("src", "https://cdn.test/org-1.png");
    // 商標取代名稱文字(Figma AdminSideNav 的 ShowLogo 變體);名稱仍由 alt 讀得到
    expect(within(nav).queryByText("平台根組織")).not.toBeInTheDocument();
  });
});

describe("即時通道連線狀態(頭像選單的小圓點)", () => {
  it("即時通道停用 / 連不上 → 黃點(慢速模式),滑過顯示狀態文字", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/" });
    await findSideNav();

    const dot = await screen.findByTestId("realtime-status");
    await waitFor(() => {
      expect(dot).toHaveAttribute("data-status", "slow");
    });
    expect(dot).toHaveAttribute("title", "重新連線中(慢速模式,每 60 秒更新)");
  });
});

describe("路由與導向(ADR-0011「路由與導向規則」:模組路由 / 群組路由 / `/`)", () => {
  it("`/` → 側欄第一個能進的頁:有總覽權限就是 /overview(佔位內容:問候 + 當前組織)", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/" });

    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    expect(screen.getByRole("banner")).toHaveTextContent("總覽");
  });

  it("`/` 而沒有總覽權限 → 依側欄順序深度優先找第一個 link(只綁示範模組2 → /demo/sample-two)", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );

    renderApp({ path: "/" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/demo/sample-two",
      );
    });
    expect(screen.getByRole("banner")).toHaveTextContent("示範模組2");
  });

  it("`/` 而側欄一個能進的頁都沒有 → 無權限頁(沒有「回首頁」按鈕)", async () => {
    server.use(...authWorld({ hasRefreshCookie: true, modules: [] }).handlers);

    renderApp({ path: "/" });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "回首頁" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });

  it("群組路由 /system → 該群組底下第一個 link(/system/org-manager);同一條規則", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
        .handlers,
    );

    renderApp({ path: "/system" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/system/org-manager",
      );
    });
  });

  it("手打 /system/org-manager 而模組陣列無此模組 → 無權限頁(有「回首頁」)", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: sampleTwoModules })
        .handlers,
    );

    renderApp({ path: "/system/org-manager" });

    expect(
      await screen.findByRole("heading", { name: "沒有權限進入此頁面" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回首頁" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/system/org-manager",
    );
  });

  it("有此模組 → 佔位頁顯示模組名,AppBar 標題同步", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: placeholderModules })
        .handlers,
    );

    // 沒登記頁面元件的模組驗佔位頁(示範家族自 #321 起全部有真頁面,改用專用夾具)
    renderApp({ path: "/demo/not-implemented" });

    const heading = await screen.findByRole("heading", { name: "未實作模組" });
    expect(screen.getByRole("main")).toContainElement(heading);
    expect(screen.getByRole("banner")).toHaveTextContent("未實作模組");
  });

  it("隱藏頁(編輯頁)有路由可進;點側欄連結切換內容區", async () => {
    server.use(
      ...authWorld({ hasRefreshCookie: true, modules: placeholderModules })
        .handlers,
    );

    const { user } = renderApp({ path: "/demo/not-implemented/edit-page" });
    expect(
      await screen.findByRole("heading", { name: "編輯" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "未實作模組" }));

    const heading = await screen.findByRole("heading", { name: "未實作模組" });
    expect(screen.getByRole("main")).toContainElement(heading);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/demo/not-implemented",
    );
  });

  it("mustChangePassword=true → 導向 /change-password,不進殼", async () => {
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: superAdminModules,
        mustChangePassword: true,
      }).handlers,
    );

    renderApp({ path: "/system/org-manager" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/change-password",
      );
    });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("AppBar(當前組織切換、使用者選單、語言)", () => {
  const tenant = { id: "org-2", name: "測試租戶" };

  it("組織切換器列出所屬組織;切換後換票、me 重取、當前組織更新", async () => {
    const world = authWorld({
      hasRefreshCookie: true,
      modules: [overviewModule, ...sampleTwoModules],
      orgs: [testOrg, tenant],
    });
    server.use(...world.handlers);
    let lastBearer: string | null = null;
    server.events.on("request:start", ({ request }) => {
      lastBearer = request.headers.get("authorization");
    });

    const { user } = renderApp({ path: "/overview" });
    const switcher = await screen.findByRole("combobox", { name: "當前組織" });
    expect(switcher).toHaveTextContent("平台根組織");
    const meCallsBefore = world.calls.me;

    await user.click(switcher);
    await user.click(await screen.findByRole("option", { name: "測試租戶" }));

    await waitFor(() => {
      expect(switcher).toHaveTextContent("測試租戶");
    });
    expect(world.calls.switchOrg).toBe(1);
    expect(world.calls.me).toBe(meCallsBefore + 1);
    expect(lastBearer).toBe(`Bearer ${SWITCHED_ACCESS_TOKEN}`);
    expect(
      within(await findSideNav()).getByText("測試租戶"),
    ).toBeInTheDocument();
    expect(screen.getByText("當前組織:測試租戶")).toBeInTheDocument();
  });

  it("切換當前組織成功 → 立即換發即時通道的訂閱憑證(RealtimeConnection.refresh)", async () => {
    const refresh = jest.spyOn(RealtimeConnection.prototype, "refresh");
    try {
      const world = authWorld({
        hasRefreshCookie: true,
        modules: [overviewModule, ...sampleTwoModules],
        orgs: [testOrg, tenant],
      });
      server.use(...world.handlers);

      const { user } = renderApp({ path: "/overview" });
      const switcher = await screen.findByRole("combobox", {
        name: "當前組織",
      });
      expect(refresh).not.toHaveBeenCalled();
      await user.click(switcher);
      await user.click(await screen.findByRole("option", { name: "測試租戶" }));

      await waitFor(() => {
        expect(refresh).toHaveBeenCalledTimes(1);
      });
      expect(world.calls.switchOrg).toBe(1);
    } finally {
      refresh.mockRestore();
    }
  });

  it("使用者選單:登出所有裝置 → 打 api、回登入頁", async () => {
    const world = authWorld({
      hasRefreshCookie: true,
      modules: sampleTwoModules,
    });
    server.use(...world.handlers);

    const { user } = renderApp({ path: "/demo/sample-two" });
    await user.click(await screen.findByRole("button", { name: "小華" }));
    await user.click(screen.getByRole("menuitem", { name: "登出所有裝置" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/login");
    });
    expect(world.calls.logoutAllDevices).toBe(1);
  });

  it("當前組織是帶標題的下拉(SelectField),AppBar 上不再有獨立的語言下拉", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/overview" });
    const switcher = await screen.findByRole("combobox", { name: "當前組織" });

    // 標題是看得到的浮動標籤,combobox 以它為名
    const labelId = switcher.getAttribute("aria-labelledby") ?? "";
    expect(
      within(screen.getByRole("banner")).getByText("當前組織", {
        selector: `[id="${labelId}"]`,
      }),
    ).toBeVisible();
    expect(switcher).toHaveTextContent("平台根組織");
    expect(screen.queryByRole("combobox", { name: "語言" })).toBeNull();
  });

  it("頭像選單:使用者卡(姓名、帳號 · 當前組織)、外觀 / 語言兩組分段按鈕、個人設定、兩個登出項", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    const { user } = renderApp({ path: "/overview" });
    await user.click(await screen.findByRole("button", { name: "小華" }));

    const menu = screen.getByRole("dialog", { name: "使用者選單" });
    expect(within(menu).getByText("root · 平台根組織")).toBeInTheDocument();
    expect(
      within(menu).getByRole("group", { name: "外觀" }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("group", { name: "語言" }),
    ).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["個人設定", "登出", "登出所有裝置"]);
  });

  it("頭像選單的語言:切到 English 後文案變英文、選單不關,並記在 localStorage", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    const { user } = renderApp({ path: "/overview" });
    await user.click(await screen.findByRole("button", { name: "小華" }));
    expect(screen.getByRole("button", { name: "繁體中文" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "English" }));

    // 切了不關:選單還在,而且已換成英文
    expect(
      await screen.findByRole("dialog", { name: "User menu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 關掉選單後整個殼都是英文
    await user.keyboard("{Escape}");
    expect(
      await screen.findByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  });

  it("頭像選單的外觀:預設跟隨系統;選「暗」後換暗色、選單不關並記在 localStorage,重新整理後維持", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    const first = renderApp({ path: "/overview" });
    await first.user.click(await screen.findByRole("button", { name: "小華" }));
    expect(screen.getByRole("button", { name: "跟隨系統" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await first.user.click(screen.getByRole("button", { name: "暗" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    expect(
      screen.getByRole("dialog", { name: "使用者選單" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暗" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 重新整理 = 整個 app 重新掛載,外觀從 localStorage 讀回
    first.unmount();
    document.documentElement.className = "";
    const second = renderApp({ path: "/overview" });
    await second.user.click(
      await screen.findByRole("button", { name: "小華" }),
    );
    expect(screen.getByRole("button", { name: "暗" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement).toHaveClass("dark");
    localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
    document.documentElement.className = "";
  });
});
