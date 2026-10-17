import { afterEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import { useColorMode } from "@repo/ui/app-theme-provider";

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
import {
  ROUTE_TABS_STORAGE_PREFIX,
  readStoredEntries,
  routeTabsStorageKey,
  writeStoredEntries,
} from "@/lib/base/route-tabs";
import {
  LEGACY_SIDE_NAV_STORAGE_KEY,
  SIDE_NAV_STORAGE_KEY,
  useSideNavStore,
} from "@/stores/base/useSideNavStore";
import { authHandlers, authWorld, testUser } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 以固定的 CookHome 設定跑(jest 的 `legacy-project`):既有瀏覽器裡的值是用這些鍵、這些格式存的,
 * 任何一把鍵或格式變了,使用者已存的語言、外觀、側欄與頁籤就會靜默消失。
 * 鍵與格式在這裡逐一寫死;與目前的專案值檔填什麼無關,換專案不必改本檔。
 */

/** 真的執行首幀腳本(以 `<script>` 插進 head),回傳 `<html>` 上的 class。 */
const runInitScript = (): string[] => {
  document.documentElement.className = "";
  const element = document.createElement("script");
  element.textContent = colorModeInitScript();
  document.head.append(element);
  element.remove();
  return [...document.documentElement.classList];
};

const setSystemPrefersDark = (prefersDark: boolean): void => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: prefersDark }),
  });
};

describe("CookHome 的瀏覽器儲存鍵與既有資料格式不變", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.className = "";
    Reflect.deleteProperty(globalThis, "matchMedia");
  });

  it("六把鍵與側欄舊鍵逐一相等", () => {
    expect({
      locale: LOCALE_STORAGE_KEY,
      colorMode: COLOR_MODE_STORAGE_KEY,
      colorScheme: COLOR_SCHEME_STORAGE_KEY,
      routeTabsPrefix: ROUTE_TABS_STORAGE_PREFIX,
      sessionChannel: SESSION_CHANNEL_NAME,
      sideNav: SIDE_NAV_STORAGE_KEY,
      legacySideNav: LEGACY_SIDE_NAV_STORAGE_KEY,
    }).toEqual({
      locale: "cookhome-admin-locale",
      colorMode: "cookhome-admin-color-mode",
      colorScheme: "cookhome-admin-color-scheme",
      routeTabsPrefix: "cookhome-admin-route-tabs",
      sessionChannel: "cookhome-admin-session",
      sideNav: "cookhome-admin-sidenav",
      legacySideNav: "cookhome.admin.sidenav",
    });
  });

  it("路由頁籤仍是每個使用者一把:前綴後附加 `:<userId>`", () => {
    expect(routeTabsStorageKey("user-1")).toBe(
      "cookhome-admin-route-tabs:user-1",
    );
  });

  it("已存的語言讀得回來,寫入仍是不包 JSON 的語系字串", () => {
    localStorage.setItem("cookhome-admin-locale", "en");
    expect(readStoredLocale()).toBe("en");

    writeStoredLocale("zh-TW");
    expect(localStorage.getItem("cookhome-admin-locale")).toBe("zh-TW");
  });

  it("已存的頁籤讀得回來,寫入仍是 `[{ route, itemLabel? }]` 的 JSON 陣列", () => {
    const stored =
      '[{"route":"/overview"},{"route":"/demo/a/1","itemLabel":"A"}]';
    sessionStorage.setItem("cookhome-admin-route-tabs:user-1", stored);

    const entries = readStoredEntries(routeTabsStorageKey("user-1"));
    expect(entries).toEqual([
      { route: "/overview" },
      { route: "/demo/a/1", itemLabel: "A" },
    ]);

    writeStoredEntries(routeTabsStorageKey("user-2"), entries);
    expect(sessionStorage.getItem("cookhome-admin-route-tabs:user-2")).toBe(
      stored,
    );
  });

  it("登入後的殼把頁籤寫進 `cookhome-admin-route-tabs:<登入者 id>`", async () => {
    server.use(...authWorld({ hasRefreshCookie: true }).handlers);

    renderApp({ path: "/overview" });
    await screen.findByRole("navigation", { name: "主選單" });

    await waitFor(() => {
      expect(
        sessionStorage.getItem(`cookhome-admin-route-tabs:${testUser.id}`),
      ).toBe('[{"route":"/overview"}]');
    });
  });

  it("已存的側欄收合狀態讀得回來,寫入仍是 persist 的 `{ state, version }` 封包", async () => {
    useSideNavStore.setState({ isCollapsed: false });
    localStorage.setItem(
      "cookhome-admin-sidenav",
      '{"state":{"isCollapsed":true},"version":0}',
    );

    await useSideNavStore.persist.rehydrate();
    expect(useSideNavStore.getState().isCollapsed).toBe(true);

    useSideNavStore.getState().toggle();
    expect(localStorage.getItem("cookhome-admin-sidenav")).toBe(
      '{"state":{"isCollapsed":false},"version":0}',
    );
  });

  it("首幀腳本讀 `cookhome-admin-color-mode`,配色名取自 `-light` / `-dark` 後綴的鍵", () => {
    setSystemPrefersDark(false);
    localStorage.setItem("cookhome-admin-color-mode", "dark");
    expect(runInitScript()).toEqual(["dark"]);

    localStorage.setItem("cookhome-admin-color-scheme-dark", "dim");
    expect(runInitScript()).toEqual(["dim"]);

    localStorage.setItem("cookhome-admin-color-mode", "light");
    localStorage.setItem("cookhome-admin-color-scheme-light", "paper");
    expect(runInitScript()).toEqual(["paper"]);
  });

  it("Provider 讀寫的是同一把 `cookhome-admin-color-mode`:已存的暗色讀得回來,改選亮色寫回去", async () => {
    localStorage.setItem("cookhome-admin-color-mode", "dark");
    server.use(...authHandlers());
    let setMode: ((mode: "light") => void) | undefined;
    const ModeProbe = () => {
      const colorMode = useColorMode();
      setMode = colorMode.setMode;
      return createElement(
        "output",
        { "data-testid": "color-mode" },
        colorMode.mode,
      );
    };

    renderApp({ path: "/login", extra: createElement(ModeProbe) });

    await waitFor(() => {
      expect(screen.getByTestId("color-mode")).toHaveTextContent("dark");
    });

    act(() => {
      setMode?.("light");
    });
    await waitFor(() => {
      expect(localStorage.getItem("cookhome-admin-color-mode")).toBe("light");
    });
  });

  it("分頁廣播走 `cookhome-admin-session`:同名 channel 收得到,別的 namespace 收不到", async () => {
    const sender = createSessionChannel();
    const sameName = new BroadcastChannel("cookhome-admin-session");
    const other = createSessionChannel("acme-portal-admin-session");
    const received: unknown[] = [];
    const leaked: SessionMessage[] = [];
    sameName.addEventListener("message", (event: MessageEvent<unknown>) => {
      received.push(event.data);
    });
    other.subscribe((message) => leaked.push(message));

    try {
      sender.postLogout("user-1");

      await waitFor(() => {
        expect(received).toEqual([{ type: "logout", userId: "user-1" }]);
      });
      expect(leaked).toEqual([]);
    } finally {
      sender.close();
      sameName.close();
      other.close();
    }
  });
});
