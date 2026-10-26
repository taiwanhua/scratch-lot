import {
  type ProjectAdminWebApp,
  projectPublic,
} from "@repo/project-config/public";

import { LOGIN_PATH } from "./paths";

/**
 * admin 可安裝成 app:由專案設定 `admin.webApp` 產生 web app manifest 與 `<head>` 標籤,
 * 正式入口的 Vite 設定在 build 時輸出 manifest、把標籤寫進 `index.html`(mock 入口不接)。
 *
 * 只提供「可安裝」,**不註冊 service worker、不做離線**:頁面與資源一律走網路,部署新版後重新整理就是新版。
 * 圖示是專案資產,放 `public/project/`,由 `scripts/app-icons/generate.mjs` 從 SVG 正本產生,
 * 檔名是兩邊共同的約定(`web-app-manifest.test.ts` 檢查檔案在、尺寸對)。
 */

/** manifest 的網址:固定不改(瀏覽器以它與 `id` 認已安裝的 app,改了可能收不到更新)。 */
export const WEB_APP_MANIFEST_PATH = "/manifest.webmanifest";

/**
 * manifest `id`:固定為根路徑,與 `start_url` 脫鉤。沒寫 `id` 時瀏覽器拿 `start_url` 當身分,
 * 之後改起始頁就會被當成另一個 app;固定下來,起始頁可以再改、已安裝的 app 不受影響。
 */
export const WEB_APP_ID = "/";

const PROJECT_ASSET_DIR = "/project";

/** 圖示檔(相對 `public/`)與像素尺寸;與 `scripts/app-icons/generate.mjs` 的輸出一致。 */
export const WEB_APP_ICONS = {
  any192: { src: `${PROJECT_ASSET_DIR}/icon-192.png`, size: 192 },
  any512: { src: `${PROJECT_ASSET_DIR}/icon-512.png`, size: 512 },
  maskable512: {
    src: `${PROJECT_ASSET_DIR}/icon-maskable-512.png`,
    size: 512,
  },
  appleTouch: { src: `${PROJECT_ASSET_DIR}/apple-touch-icon.png`, size: 180 },
} as const;

export interface WebAppManifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "standalone";
  theme_color: string;
  background_color: string;
  icons: readonly {
    src: string;
    sizes: string;
    type: "image/png";
    purpose: "any" | "maskable";
  }[];
}

const sizesOf = (size: number): string => `${String(size)}x${String(size)}`;

const manifestIcon = (
  { src, size }: { src: string; size: number },
  purpose: WebAppManifest["icons"][number]["purpose"],
): WebAppManifest["icons"][number] => ({
  src,
  sizes: sizesOf(size),
  type: "image/png",
  purpose,
});

/** manifest 內容:名稱與顏色取專案設定,其餘由底座固定(起始頁 = 登入頁、獨立視窗)。 */
export const webAppManifest = (webApp: ProjectAdminWebApp): WebAppManifest => ({
  id: WEB_APP_ID,
  name: webApp.name,
  short_name: webApp.shortName,
  // 登入頁:已登入者由登入頁導回首頁,未登入者直接看到登入表單
  start_url: LOGIN_PATH,
  scope: "/",
  display: "standalone",
  theme_color: webApp.themeColor,
  background_color: webApp.backgroundColor,
  icons: [
    manifestIcon(WEB_APP_ICONS.any192, "any"),
    manifestIcon(WEB_APP_ICONS.any512, "any"),
    manifestIcon(WEB_APP_ICONS.maskable512, "maskable"),
  ],
});

/** manifest 檔的內容(JSON 字串)。 */
export const webAppManifestSource = (webApp: ProjectAdminWebApp): string =>
  `${JSON.stringify(webAppManifest(webApp), null, 2)}\n`;

interface HeadTag {
  tag: "link" | "meta";
  attrs: Record<string, string>;
  injectTo: "head";
}

const headTag = (tag: HeadTag["tag"], attrs: HeadTag["attrs"]): HeadTag => ({
  tag,
  attrs,
  injectTo: "head",
});

/**
 * 給 Vite `transformIndexHtml` 的 `<head>` 標籤(屬性值由 Vite 跳脫)。
 * `apple-touch-icon` 給 iOS 主畫面:iOS 有它就不讀 manifest 圖示,且 iOS 不吃 maskable,所以另給一張不透明的。
 */
export const webAppHeadTags = (webApp: ProjectAdminWebApp): HeadTag[] => [
  headTag("link", { rel: "manifest", href: WEB_APP_MANIFEST_PATH }),
  headTag("meta", { name: "theme-color", content: webApp.themeColor }),
  headTag("link", {
    rel: "apple-touch-icon",
    sizes: sizesOf(WEB_APP_ICONS.appleTouch.size),
    href: WEB_APP_ICONS.appleTouch.src,
  }),
  headTag("meta", {
    name: "apple-mobile-web-app-title",
    content: webApp.shortName,
  }),
];

/** 目前專案的設定;`null` = 專案不提供 manifest(不可安裝)。 */
export const projectWebApp = (): ProjectAdminWebApp | null =>
  projectPublic.admin.webApp;
