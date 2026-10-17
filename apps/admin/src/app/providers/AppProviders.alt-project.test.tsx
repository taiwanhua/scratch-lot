import { afterEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  SESSION_CHANNEL_NAME,
  type SessionMessage,
  createSessionChannel,
} from "@/lib/base/auth/session-channel";
import {
  COLOR_MODE_STORAGE_KEY,
  COLOR_SCHEME_STORAGE_KEY,
} from "@/lib/base/color-mode";
import { colorModeInitScript } from "@/lib/base/color-mode-init";
import {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from "@/lib/base/locale";
import { projectHtmlTransform } from "@/lib/base/project-html";
import {
  ROUTE_TABS_STORAGE_PREFIX,
  routeTabsStorageKey,
} from "@/lib/base/route-tabs";
import {
  LEGACY_SIDE_NAV_STORAGE_KEY,
  SIDE_NAV_STORAGE_KEY,
  useSideNavStore,
} from "@/stores/base/useSideNavStore";
import { authHandlers, authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { primaryMainOf } from "@/test/primary-color";
import { renderApp } from "@/test/render";

/**
 * 以替代專案設定(`src/test/alternative-project.ts`)跑的對照組:整張模組圖讀到的都是替代值
 * (jest 設定的 `alt-project`)。沒有任何一行程式因此改動 —— 驗的是「只換專案值,讀取接線就跟著換」,
 * 以及替代專案不讀、不寫、不刪原專案(CookHome)留在同一個瀏覽器裡的鍵。
 */

const envelope = (isCollapsed: boolean) =>
  JSON.stringify({ state: { isCollapsed }, version: 0 });

/** 原專案在同一個瀏覽器留下的值(六把鍵 + 側欄舊鍵)。 */
const COOKHOME_STORED: Readonly<Record<string, string>> = {
  "cookhome-admin-locale": "en",
  "cookhome-admin-color-mode": "dark",
  "cookhome-admin-color-scheme-dark": "dim",
  "cookhome-admin-sidenav": envelope(true),
  "cookhome.admin.sidenav": envelope(true),
};

const seedCookhomeStorage = (): void => {
  for (const [key, value] of Object.entries(COOKHOME_STORED)) {
    localStorage.setItem(key, value);
  }
  sessionStorage.setItem(
    "cookhome-admin-route-tabs:user-1",
    '[{"route":"/overview"}]',
  );
};

const cookhomeStorageSnapshot = (): Record<string, string | null> =>
  Object.fromEntries(
    Object.keys(COOKHOME_STORED).map((key) => [key, localStorage.getItem(key)]),
  );

/** 真的執行預設的首幀腳本(以 `<script>` 插進 head),回傳 `<html>` 上的 class。 */
const runInitScript = (): string[] => {
  document.documentElement.className = "";
  const element = document.createElement("script");
  element.textContent = colorModeInitScript();
  document.head.append(element);
  element.remove();
  return [...document.documentElement.classList];
};

describe("替代專案:品牌名與主色跟著專案設定換", () => {
  it("登入頁顯示替代品牌名,頁腳帶同一個名字,畫面上沒有原品牌", async () => {
    server.use(...authHandlers());

    renderApp({ path: "/login" });

    expect(
      await screen.findByRole("heading", { name: "Acme Portal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `© ${String(new Date().getFullYear())} Acme Portal · 僅供授權人員使用`,
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cookhome/i);
  });

  it("沒有當前組織時,側欄頂部退回替代品牌名", async () => {
    server.use(...authWorld({ hasRefreshCookie: true, orgs: [] }).handlers);

    renderApp({ path: "/" });
    const nav = await screen.findByRole("navigation", { name: "主選單" });

    expect(within(nav).getByText("Acme Portal")).toBeInTheDocument();
    expect(within(nav).queryByText("CookHome")).not.toBeInTheDocument();
  });

  it("主題主色是替代專案的 primary", async () => {
    server.use(...authHandlers());

    renderApp({ path: "/login" });
    await screen.findByRole("heading", { name: "Acme Portal" });

    expect(primaryMainOf(document)).toBe("#2065D1");
  });

  it("HTML title 換成替代專案的 documentTitle,並跳脫特殊字元", () => {
    const entry = "<head><title></title></head>";

    expect(projectHtmlTransform("app")(entry)).toBe(
      "<head><title>Acme &lt;Admin&gt; &amp; Co</title></head>",
    );
    expect(projectHtmlTransform("mock")(entry)).toBe(
      "<head><title>Acme &lt;Admin&gt; &amp; Co(mock)</title></head>",
    );
  });
});

describe("替代專案:儲存鍵換成自己的 namespace,不碰原專案的鍵", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.className = "";
    Reflect.deleteProperty(globalThis, "matchMedia");
  });

  it("六把鍵都以替代 slug 開頭,沒有側欄舊鍵", () => {
    expect({
      locale: LOCALE_STORAGE_KEY,
      colorMode: COLOR_MODE_STORAGE_KEY,
      colorScheme: COLOR_SCHEME_STORAGE_KEY,
      routeTabsPrefix: ROUTE_TABS_STORAGE_PREFIX,
      routeTabsOfUser: routeTabsStorageKey("user-1"),
      sessionChannel: SESSION_CHANNEL_NAME,
      sideNav: SIDE_NAV_STORAGE_KEY,
      legacySideNav: LEGACY_SIDE_NAV_STORAGE_KEY,
    }).toEqual({
      locale: "acme-portal-admin-locale",
      colorMode: "acme-portal-admin-color-mode",
      colorScheme: "acme-portal-admin-color-scheme",
      routeTabsPrefix: "acme-portal-admin-route-tabs",
      routeTabsOfUser: "acme-portal-admin-route-tabs:user-1",
      sessionChannel: "acme-portal-admin-session",
      sideNav: "acme-portal-admin-sidenav",
      legacySideNav: null,
    });
  });

  it("語言:不讀原專案存的語言;寫入只動自己的鍵", () => {
    seedCookhomeStorage();

    expect(readStoredLocale()).toBe("zh-TW");

    writeStoredLocale("en");
    expect(localStorage.getItem("acme-portal-admin-locale")).toBe("en");
    expect(cookhomeStorageSnapshot()).toEqual(COOKHOME_STORED);
  });

  it("側欄:不讀原專案的新舊鍵、不搬也不刪;收合狀態寫進自己的鍵", async () => {
    useSideNavStore.setState({ isCollapsed: false });
    localStorage.clear();
    seedCookhomeStorage();

    await useSideNavStore.persist.rehydrate();
    expect(useSideNavStore.getState().isCollapsed).toBe(false);
    expect(cookhomeStorageSnapshot()).toEqual(COOKHOME_STORED);

    useSideNavStore.getState().toggle();
    expect(localStorage.getItem("acme-portal-admin-sidenav")).toBe(
      envelope(true),
    );
    expect(cookhomeStorageSnapshot()).toEqual(COOKHOME_STORED);
  });

  it("首幀外觀腳本:只讀自己的鍵,原專案存的暗色不影響", () => {
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false }),
    });
    seedCookhomeStorage();

    expect(runInitScript()).toEqual(["light"]);

    localStorage.setItem("acme-portal-admin-color-mode", "dark");
    expect(runInitScript()).toEqual(["dark"]);
    expect(cookhomeStorageSnapshot()).toEqual(COOKHOME_STORED);
  });

  it("登入後操作一輪,原專案留下的值一筆都沒被動到", async () => {
    seedCookhomeStorage();
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/overview" });
    await screen.findByRole("navigation", { name: "主選單" });
    await waitFor(() => {
      expect(
        Object.keys(sessionStorage).some((key) =>
          key.startsWith("acme-portal-admin-route-tabs:"),
        ),
      ).toBe(true);
    });

    expect(cookhomeStorageSnapshot()).toEqual(COOKHOME_STORED);
    expect(sessionStorage.getItem("cookhome-admin-route-tabs:user-1")).toBe(
      '[{"route":"/overview"}]',
    );
    expect(
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(
        (key) =>
          !key.startsWith("acme-portal-admin-") && !key.startsWith("cookhome"),
      ),
    ).toEqual([]);
  });

  it("分頁廣播:同專案互通,與原專案的 channel 互不收訊", async () => {
    const sender = createSessionChannel();
    const receiver = createSessionChannel();
    const cookhome = createSessionChannel("cookhome-admin-session");
    const received: SessionMessage[] = [];
    const leaked: SessionMessage[] = [];
    receiver.subscribe((message) => received.push(message));
    cookhome.subscribe((message) => leaked.push(message));

    try {
      cookhome.postLogout("someone-else");
      sender.postLogout("user-1");

      await waitFor(() => {
        expect(received).toEqual([{ type: "logout", userId: "user-1" }]);
      });
      expect(leaked).toEqual([]);
    } finally {
      sender.close();
      receiver.close();
      cookhome.close();
    }
  });
});
