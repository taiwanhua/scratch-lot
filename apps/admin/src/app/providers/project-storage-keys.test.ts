import { afterEach, describe, expect, it } from "@jest/globals";

import { projectPublic } from "@repo/project-config/public";

import { SESSION_CHANNEL_NAME } from "@/lib/base/auth/session-channel";
import {
  COLOR_MODE_STORAGE_KEY,
  COLOR_SCHEME_STORAGE_KEY,
} from "@/lib/base/color-mode";
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
} from "@/stores/base/useSideNavStore";

/**
 * 正式常數 × 目前的專案設定:六把鍵都掛在目前的 slug 底下,資料格式固定。
 * 期望的鍵由 slug 與**本檔自己寫的後綴**組出(不呼叫受測的鍵生成函式),也不寫任何專案的字面鍵 ——
 * 換專案只改專案值檔,本檔不必改。CookHome 歷史鍵的逐字比對在
 * `project-storage-keys.legacy-project.test.ts`。(放在 app 層:要同時讀 lib 與 stores 的鍵。)
 */
describe("admin 的瀏覽器儲存鍵來自目前的專案設定", () => {
  const { slug } = projectPublic;

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("六把鍵都是 `<slug>-admin-<用途>`,側欄舊鍵取自專案設定", () => {
    expect({
      locale: LOCALE_STORAGE_KEY,
      colorMode: COLOR_MODE_STORAGE_KEY,
      colorScheme: COLOR_SCHEME_STORAGE_KEY,
      routeTabsPrefix: ROUTE_TABS_STORAGE_PREFIX,
      sessionChannel: SESSION_CHANNEL_NAME,
      sideNav: SIDE_NAV_STORAGE_KEY,
      legacySideNav: LEGACY_SIDE_NAV_STORAGE_KEY,
    }).toEqual({
      locale: `${slug}-admin-locale`,
      colorMode: `${slug}-admin-color-mode`,
      colorScheme: `${slug}-admin-color-scheme`,
      routeTabsPrefix: `${slug}-admin-route-tabs`,
      sessionChannel: `${slug}-admin-session`,
      sideNav: `${slug}-admin-sidenav`,
      legacySideNav: projectPublic.compatibility.legacySideNavStorageKey,
    });
  });

  it("路由頁籤每個使用者一把:前綴後附加 `:<userId>`", () => {
    expect(routeTabsStorageKey("user-1")).toBe(
      `${slug}-admin-route-tabs:user-1`,
    );
  });

  it("語言:寫入的是不包 JSON 的語系字串,讀得回來", () => {
    writeStoredLocale("en");

    expect(localStorage.getItem(`${slug}-admin-locale`)).toBe("en");
    expect(readStoredLocale()).toBe("en");
  });

  it("頁籤:寫入的是 `[{ route, itemLabel? }]` 的 JSON 陣列,讀得回來", () => {
    const stored =
      '[{"route":"/overview"},{"route":"/demo/a/1","itemLabel":"A"}]';
    sessionStorage.setItem(`${slug}-admin-route-tabs:user-1`, stored);

    const entries = readStoredEntries(routeTabsStorageKey("user-1"));
    expect(entries).toEqual([
      { route: "/overview" },
      { route: "/demo/a/1", itemLabel: "A" },
    ]);

    writeStoredEntries(routeTabsStorageKey("user-2"), entries);
    expect(sessionStorage.getItem(`${slug}-admin-route-tabs:user-2`)).toBe(
      stored,
    );
  });
});
