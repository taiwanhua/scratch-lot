import { COLOR_MODE_STORAGE_KEY, COLOR_SCHEME_STORAGE_KEY } from "./color-mode";

/**
 * 首幀外觀腳本:在 React 起來前依 localStorage 先把 `<html>` 的 class 設成 `light` / `dark`
 * (主題 `colorSchemeSelector: "class"`),選了暗色重新整理才不會先閃亮色。
 *
 * 不用 MUI 的 `InitColorSchemeScript`:它輸出 React 內嵌 `<script>`,React 插入的內嵌 script 不會執行,
 * Vite SPA 只能在 html 入口注入;由 `vite.config.ts` / `vite.mock.config.ts` 用 `transformIndexHtml`
 * 把這段塞進 `<head>`,key 與 `useColorMode` 用的是同一組常數,不手抄。
 */
export const colorModeInitScript = (
  modeKey: string = COLOR_MODE_STORAGE_KEY,
  schemeKey: string = COLOR_SCHEME_STORAGE_KEY,
): string => `(function () {
  try {
    var mode = window.localStorage.getItem(${JSON.stringify(modeKey)}) || "system";
    var light = window.localStorage.getItem(${JSON.stringify(`${schemeKey}-light`)}) || "light";
    var dark = window.localStorage.getItem(${JSON.stringify(`${schemeKey}-dark`)}) || "dark";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var scheme = mode === "dark" || (mode === "system" && prefersDark) ? dark : light;
    document.documentElement.classList.add(scheme);
  } catch (error) {
    /* localStorage 不可用(隱私模式)就交給 React 端決定 */
  }
})();`;

/** 給 Vite `transformIndexHtml` 的標籤描述(兩支 vite 設定共用)。 */
export const colorModeInitTag = () =>
  ({
    tag: "script",
    injectTo: "head",
    children: colorModeInitScript(),
  }) as const;
