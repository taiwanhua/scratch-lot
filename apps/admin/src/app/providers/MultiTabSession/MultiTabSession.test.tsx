import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";

import { SESSION_CHANNEL_NAME } from "@/lib/base/auth/session-channel";
import { routeTabsStorageKey } from "@/lib/base/route-tabs";
import { authWorld, testUser } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/** 另一個分頁登入的帳號(分頁 A 是小華、分頁 B 登入小明)。 */
const otherAccount = { ...testUser, id: "user-2", name: "小明" };

/** 扮演「另一個分頁」:同名 channel 的另一端(BroadcastChannel 不會把訊息送回發送端)。 */
const openOtherTab = () => new BroadcastChannel(SESSION_CHANNEL_NAME);

describe("多分頁登入同步(BroadcastChannel)", () => {
  it("其他分頁廣播登出 → 本分頁立即回登入頁,並清掉這個分頁的頁籤存檔", async () => {
    sessionStorage.clear();
    const world = authWorld({ hasRefreshCookie: true });
    server.use(...world.handlers);
    renderApp({ path: "/overview" });
    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    const tabsKey = routeTabsStorageKey(testUser.id);
    await waitFor(() => {
      expect(sessionStorage.getItem(tabsKey)).not.toBeNull();
    });

    const otherTab = openOtherTab();
    otherTab.postMessage({ type: "logout", userId: testUser.id });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/login");
    });
    expect(screen.getByLabelText("帳號")).toBeInTheDocument();
    expect(sessionStorage.getItem(tabsKey)).toBeNull();
    otherTab.close();
  });

  it("本分頁登出 → 打 api logout、回登入頁、廣播 logout 給其他分頁", async () => {
    const world = authWorld({ hasRefreshCookie: true });
    server.use(...world.handlers);
    const { user } = renderApp({ path: "/" });
    expect(await screen.findByText("小華,你好")).toBeInTheDocument();

    const otherTab = openOtherTab();
    const received = new Promise<unknown>((resolve) => {
      otherTab.addEventListener("message", (event: MessageEvent<unknown>) => {
        const message = event.data as { type?: unknown };
        if (message.type === "logout") {
          resolve(event.data);
        }
      });
    });

    // 登出在 AppBar 的使用者選單裡(登入線5 殼)
    await user.click(screen.getByRole("button", { name: "小華" }));
    await user.click(screen.getByRole("menuitem", { name: "登出" }));

    await expect(received).resolves.toEqual({
      type: "logout",
      userId: testUser.id,
    });
    expect(world.calls.logout).toBe(1);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/login");
    });
    otherTab.close();
  });

  it("本分頁登入成功 → 廣播 login(帶登入者)給其他分頁", async () => {
    const world = authWorld({ hasRefreshCookie: false });
    server.use(...world.handlers);
    const { user } = renderApp({ path: "/" });

    const otherTab = openOtherTab();
    const received = new Promise<unknown>((resolve) => {
      otherTab.addEventListener("message", (event: MessageEvent<unknown>) => {
        resolve(event.data);
      });
    });

    await user.type(await screen.findByLabelText("帳號"), "root");
    await user.type(screen.getByLabelText("密碼"), "secret-1234");
    await user.click(screen.getByRole("button", { name: "登入" }));

    await expect(received).resolves.toEqual({
      type: "login",
      userId: testUser.id,
      name: "小華",
    });
    otherTab.close();
  });

  it("其他分頁登入了別的帳號 → 顯示提示,隨即切成新帳號", async () => {
    sessionStorage.clear();
    const world = authWorld({ hasRefreshCookie: true });
    server.use(...world.handlers);
    renderApp({ path: "/overview" });
    expect(await screen.findByText("小華,你好")).toBeInTheDocument();

    // 分頁 B 登入小明:共用的 refresh cookie 已經換人,所以本分頁重新換票就會拿到小明的票
    server.use(
      api.query("Me", () => HttpResponse.json({ data: { me: otherAccount } })),
    );
    const otherTab = openOtherTab();
    otherTab.postMessage({
      type: "login",
      userId: otherAccount.id,
      name: otherAccount.name,
    });

    expect(
      await screen.findByText("已在其他分頁登入為 小明,此分頁將切換"),
    ).toBeInTheDocument();
    // 提示不可關閉:沒有關閉鈕,Esc 也關不掉(沒接 onClose)
    expect(screen.queryByRole("button", { name: "關閉" })).toBeNull();

    expect(await screen.findByText("小明,你好")).toBeInTheDocument();
    expect(
      screen.queryByText("已在其他分頁登入為 小明,此分頁將切換"),
    ).toBeNull();
    // 換帳號後回首頁,再由路由規則轉到新帳號側欄的第一個模組
    expect(screen.getByTestId("location")).toHaveTextContent("/overview");
    // 舊帳號的頁籤存檔沒有留在這個分頁
    expect(sessionStorage.getItem(routeTabsStorageKey(testUser.id))).toBeNull();
    otherTab.close();
  });

  it("其他分頁登入的是同一個帳號 → 忽略,不提示也不重新換票", async () => {
    const world = authWorld({ hasRefreshCookie: true });
    server.use(...world.handlers);
    renderApp({ path: "/overview" });
    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    const refreshCalls = world.calls.refresh;

    const otherTab = openOtherTab();
    otherTab.postMessage({
      type: "login",
      userId: testUser.id,
      name: testUser.name,
    });

    expect(await screen.findByText("小華,你好")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(world.calls.refresh).toBe(refreshCalls);
    otherTab.close();
  });
});
