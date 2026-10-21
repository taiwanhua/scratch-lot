import { jest } from "@jest/globals";

/**
 * 排班表月 / 週 / 日檢視的測試工具(測試資料,不是測試檔):固定在 2026-11(夾具 1–7 日有資料;
 * 11/1 是星期日,第一週 = 11/1–11/7)。
 */

/** 排班作業 → 排班表的網址;`params` 例 `view=week&date=2026-11-04`。 */
export const rosterPath = (params: string): string =>
  `/schedule/manage?tab=roster&month=2026-11&${params}`;

/** 目前網址的查詢參數。 */
export const searchParam = (key: string): string | null =>
  new URLSearchParams(globalThis.location.search).get(key);

/** media query 裡某個條件的 px(`max-width: 599.95px` → 599.95);沒有這個條件 → null。 */
const pixelsOf = (query: string, feature: string): number | null => {
  const match = new RegExp(String.raw`${feature}:\s*([\d.]+)px`, "u").exec(
    query,
  );
  return match?.[1] === undefined ? null : Number(match[1]);
};

/**
 * 模擬某個視窗寬度(px):`matchMedia` 替身依 `max-width` / `min-width` 判斷(theme 斷點的 `down` / `up`)。
 * 電腦 1440、平板 1024、手機 390;測試檔用 `restoreViewportAfterEach()` 還原。
 */
export const setViewportWidth = (width: number): void => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const max = pixelsOf(query, "max-width");
      const min = pixelsOf(query, "min-width");
      return {
        matches:
          (max === null || width <= max) && (min === null || width >= min),
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: () => false,
      };
    },
  });
};
