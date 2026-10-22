import { afterEach } from "@jest/globals";
import { act } from "@testing-library/react";

/**
 * 可以在測試中途改寬度的視窗(px):`matchMedia` 替身依查詢裡的 `min-width` / `max-width` 判斷
 * (MUI 的 `down("lg")` 是 `(max-width:1199.95px)`、`up("lg")` 是 `(min-width:1200px)`),
 * `resizeViewport` 改寬度後通知所有訂閱者,`useBreakpointDown` 跟著重算 —— 模擬使用者拖窄 / 拉寬視窗。
 * 只要固定一種寬度時用 `viewport.ts` 的 `setMobileViewport`。在 `describe` 裡呼叫 `restoreResizableViewportAfterEach()` 還原。
 */
let currentWidth = 0;
const listeners = new Set<() => void>();

const matchesWidth = (query: string): boolean => {
  const min = /min-width:\s*([\d.]+)px/.exec(query);
  const max = /max-width:\s*([\d.]+)px/.exec(query);
  return (
    (min === null || currentWidth >= Number(min[1])) &&
    (max === null || currentWidth <= Number(max[1]))
  );
};

export const setResizableViewport = (width: number): void => {
  currentWidth = width;
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return matchesWidth(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    }),
  });
};

/** 把視窗改成 `width`(px)並通知訂閱者(在 `act` 裡,畫面重算完才回來)。 */
export const resizeViewport = (width: number): void => {
  currentWidth = width;
  act(() => {
    for (const listener of listeners) {
      listener();
    }
  });
};

export const restoreResizableViewportAfterEach = (): void => {
  afterEach(() => {
    listeners.clear();
    Reflect.deleteProperty(globalThis, "matchMedia");
  });
};
