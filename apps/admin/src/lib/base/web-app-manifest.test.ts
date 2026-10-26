import { describe, expect, it } from "@jest/globals";

import { LOGIN_PATH } from "./paths";
import {
  WEB_APP_ID,
  webAppHeadTags,
  webAppManifest,
  webAppManifestSource,
} from "./web-app-manifest";

/** 與任何專案都不同的值;名稱帶 HTML / JSON 特殊字元,確認原樣進 manifest。 */
const SAMPLE = {
  name: 'Acme "Portal" <Admin>',
  shortName: "Acme",
  themeColor: "#0B3D91",
  backgroundColor: "#F4F6F8",
};

describe("web-app-manifest:可安裝 app 的 manifest 與 <head> 標籤", () => {
  it("名稱與顏色取設定,其餘固定:id 與起始頁脫鉤、起始頁是登入頁、獨立視窗", () => {
    expect(webAppManifest(SAMPLE)).toEqual({
      id: WEB_APP_ID,
      name: SAMPLE.name,
      short_name: SAMPLE.shortName,
      start_url: LOGIN_PATH,
      scope: "/",
      display: "standalone",
      theme_color: SAMPLE.themeColor,
      background_color: SAMPLE.backgroundColor,
      icons: [
        {
          src: "/project/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/project/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/project/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    });
    expect(WEB_APP_ID).not.toBe(LOGIN_PATH);
  });

  it("manifest 檔是合法 JSON,特殊字元原樣保留", () => {
    const parsed = JSON.parse(webAppManifestSource(SAMPLE)) as {
      name: string;
    };

    expect(parsed.name).toBe(SAMPLE.name);
  });

  it("<head> 標籤:manifest、theme-color、apple-touch-icon、主畫面標題", () => {
    expect(webAppHeadTags(SAMPLE)).toEqual([
      {
        tag: "link",
        attrs: { rel: "manifest", href: "/manifest.webmanifest" },
        injectTo: "head",
      },
      {
        tag: "meta",
        attrs: { name: "theme-color", content: SAMPLE.themeColor },
        injectTo: "head",
      },
      {
        tag: "link",
        attrs: {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/project/apple-touch-icon.png",
        },
        injectTo: "head",
      },
      {
        tag: "meta",
        attrs: { name: "apple-mobile-web-app-title", content: "Acme" },
        injectTo: "head",
      },
    ]);
  });
});
