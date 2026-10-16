import { describe, expect, it } from "@jest/globals";

import { createAdminStorageKeys } from "./admin-storage-keys";

describe("createAdminStorageKeys:admin 的瀏覽器儲存鍵由 slug 生成", () => {
  it("七把鍵的格式都是 `<slug>-admin-<用途>`", () => {
    expect(createAdminStorageKeys("acme-portal")).toEqual({
      locale: "acme-portal-admin-locale",
      colorMode: "acme-portal-admin-color-mode",
      colorScheme: "acme-portal-admin-color-scheme",
      routeTabsPrefix: "acme-portal-admin-route-tabs",
      sessionChannel: "acme-portal-admin-session",
      sideNav: "acme-portal-admin-sidenav",
      sectionsPrefix: "acme-portal-admin-sections",
    });
  });

  it("不同 slug 的七把鍵完全不重疊", () => {
    const first = Object.values(createAdminStorageKeys("cookhome"));
    const second = new Set(Object.values(createAdminStorageKeys("acme")));
    expect(first.filter((key) => second.has(key))).toEqual([]);
  });

  it.each(["", "Acme", "acme portal", "acme.admin", "-acme"])(
    "非法 slug %p 直接拒絕,不生成鍵",
    (slug) => {
      expect(() => createAdminStorageKeys(slug)).toThrow(/slug/);
    },
  );
});
