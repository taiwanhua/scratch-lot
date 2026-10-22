import { afterAll, afterEach, beforeAll, jest } from "@jest/globals";

/**
 * jsdom 不算版面,所有元素的 offsetHeight / offsetWidth 都是 0,`@repo/ui/data-table` 的虛擬捲動會以為
 * 捲動容器「看得到 0 列」而一列都不畫(做法同 `packages/ui/src/DataTable/DataTable.test.tsx`)。
 * 用到 DataTable 的頁面測試在檔案頂層呼叫一次,測試期間給固定的視窗大小。
 */
const VIEWPORT = { offsetHeight: 600, offsetWidth: 1200 } as const;

export const setupFakeViewport = (): void => {
  const originals = Object.fromEntries(
    Object.keys(VIEWPORT).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]),
  );

  beforeAll(() => {
    for (const [key, value] of Object.entries(VIEWPORT)) {
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get: () => value,
      });
    }
  });

  afterAll(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor !== undefined) {
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      }
    }
  });
};

/**
 * 模擬手機寬(所有 `max-width` 查詢都成立,即小於任何斷點):`matchMedia` 替身讓 `max-width` 查詢成立;測試結束還原(jsdom 本來沒有 `matchMedia`)。
 */
export const restoreViewportAfterEach = (): void => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "matchMedia");
  });
};

export const setMobileViewport = (): void => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: () => false,
    }),
  });
};

/**
 * 模擬指定的視窗寬(px):`matchMedia` 替身依查詢裡的 `min-width` / `max-width` 判斷是否成立
 * (MUI 的 `down("md")` 是 `(max-width:899.95px)`、`up("md")` 是 `(min-width:900px)`)。
 * 要分辨斷點之間的寬度(例:768 直拿平板)時用它;只要「手機寬」用 `setMobileViewport`。搭配 `restoreViewportAfterEach`。
 */
export const setViewportWidth = (width: number): void => {
  const matches = (query: string): boolean => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return (
      (min === null || width >= Number(min[1])) &&
      (max === null || width <= Number(max[1]))
    );
  };
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: () => false,
    }),
  });
};
