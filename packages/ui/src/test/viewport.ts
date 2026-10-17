import { afterAll, beforeAll } from "@jest/globals";

/**
 * jsdom 不算版面,所有元素的 offsetHeight / offsetWidth 都是 0,虛擬捲動(`DataTable`)會以為
 * 捲動容器「看得到 0 列」而一列都不畫。在測試檔頂層呼叫,測試期間給一個固定的視窗大小
 * (600 高 ≈ 11 列 medium),結束後還原(同 admin 的 `src/test/viewport.ts`)。
 */
const DEFAULT_VIEWPORT = { offsetHeight: 600, offsetWidth: 1000 } as const;

export const setupFakeViewport = (
  viewport: { offsetHeight: number; offsetWidth: number } = DEFAULT_VIEWPORT,
) => {
  const originals = Object.fromEntries(
    Object.keys(viewport).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]),
  );

  beforeAll(() => {
    for (const [key, value] of Object.entries(viewport)) {
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
