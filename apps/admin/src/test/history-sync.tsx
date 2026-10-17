import { useLayoutEffect } from "react";
import { useLocation } from "react-router";

/** nuqs 認得的標記:帶這個標記的 `replaceState` 只改網址列,不通知 nuqs(它自己寫網址時也這樣做)。 */
const SILENT_MARKER = "__nuqs__";

/**
 * 測試用:讓瀏覽器網址列跟著 MemoryRouter 走,行為對齊正式環境的 BrowserRouter。
 *
 * nuqs 的 react-router adapter 讀的是 `window.location`,並且只在 `history.pushState` / `replaceState`
 * 被呼叫時得知網址變了(正式環境由 BrowserRouter 在渲染新頁**之前**呼叫);MemoryRouter 不碰 `window.history`,
 * 測試裡點頁籤、側欄、導向後 `useUrlState` 會讀到上一個網址。所以這裡分兩步:
 *
 * 1. 渲染時(排在 `RootProviders` 之前,新頁面的 hook 初始化前)以 nuqs 的標記靜默改網址列,新掛載的頁面讀到新網址;
 * 2. 提交後再 `replaceState` 一次(不帶標記),讓已掛載的 nuqs 讀者收到通知。
 *
 * 起始網址由 `renderApp` 在渲染前寫好。
 */
export const HistorySync = () => {
  const { pathname, search, hash } = useLocation();
  const href = `${pathname}${search}${hash}`;
  const current = `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
  if (current !== href) {
    globalThis.history.replaceState(
      globalThis.history.state,
      SILENT_MARKER,
      href,
    );
  }
  useLayoutEffect(() => {
    globalThis.history.replaceState(globalThis.history.state, "", href);
  }, [href]);
  return null;
};
