import { describe, expect, it } from "@jest/globals";

import { createAdminStorageKeys } from "./admin-storage-keys";
import { type ProjectMailConfig, assertProjectMailConfig } from "./mail-config";
import {
  type ProjectPublicConfig,
  assertProjectPublicConfig,
} from "./public-config";

/**
 * 舊資料相容的固定夾具:抽出專案設定前,CookHome 散落各處的值逐一寫死在這裡。
 * 本檔**不讀** `src/project/`,所以換專案不必改它;它守的是底座的契約與鍵生成
 * 仍然容得下、也生得出既有專案瀏覽器裡已經存在的那些鍵與寄件識別。
 */
const COOKHOME_PUBLIC: ProjectPublicConfig = {
  slug: "cookhome",
  brand: { name: "CookHome", primary: "#FB7B10" },
  // 抽設定前沒有 manifest(不可安裝)
  admin: { documentTitle: "CookHome 後台管理", webApp: null },
  front: {
    metadata: {
      "zh-TW": {
        title: "CookHome — 家常食譜",
        titleTemplate: "%s | CookHome",
        description: "分享與收藏家常食譜的網站",
      },
      en: {
        title: "CookHome — Home-style Recipes",
        titleTemplate: "%s | CookHome",
        description: "Share and collect home-style recipes",
      },
    },
  },
  compatibility: { legacySideNavStorageKey: "cookhome.admin.sidenav" },
};

const COOKHOME_MAIL: ProjectMailConfig = {
  brandName: "CookHome",
  senderEmail: "no-reply@cookhome.online",
  signature: "CookHome 後台管理系統",
};

describe("CookHome 的歷史值仍在契約之內", () => {
  it("公開設定(含點分隔的側欄舊鍵)通過驗證,內容不被改寫", () => {
    expect(assertProjectPublicConfig(COOKHOME_PUBLIC)).toBe(COOKHOME_PUBLIC);
  });

  it("slug `cookhome` 生出的七把鍵與既有瀏覽器裡的鍵逐字相同", () => {
    expect(createAdminStorageKeys("cookhome")).toEqual({
      locale: "cookhome-admin-locale",
      colorMode: "cookhome-admin-color-mode",
      colorScheme: "cookhome-admin-color-scheme",
      routeTabsPrefix: "cookhome-admin-route-tabs",
      sessionChannel: "cookhome-admin-session",
      sideNav: "cookhome-admin-sidenav",
      sectionsPrefix: "cookhome-admin-sections",
    });
  });

  it("寄件識別通過驗證", () => {
    expect(assertProjectMailConfig(COOKHOME_MAIL)).toBe(COOKHOME_MAIL);
  });
});
