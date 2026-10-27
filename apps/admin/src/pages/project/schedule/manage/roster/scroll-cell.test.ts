import { describe, expect, it } from "@jest/globals";

import { scrollCellIntoView } from "./scroll-cell";

/** jsdom 不算版面:給捲動容器固定的尺寸與位置(位置不隨捲動變,只驗捲動量)。 */
const box = (
  element: HTMLElement,
  size: {
    width: number;
    height: number;
    scrollWidth: number;
    scrollHeight: number;
  },
  rect: { left: number; top: number },
) => {
  // jsdom 的 scrollLeft / scrollTop 寫了不留:換成存值的屬性
  let left = 0;
  let top = 0;
  Object.defineProperties(element, {
    scrollLeft: {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    },
    clientWidth: { configurable: true, get: () => size.width },
    clientHeight: { configurable: true, get: () => size.height },
    scrollWidth: { configurable: true, get: () => size.scrollWidth },
    scrollHeight: { configurable: true, get: () => size.scrollHeight },
  });
  element.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      width: size.width,
      height: size.height,
    }) as DOMRect;
};

describe("scrollCellIntoView:只捲檢視自己的容器,不橫向捲 <main>", () => {
  it("格子捲到檢視容器的中間;<main> 只直向捲、橫向不動", () => {
    const main = document.createElement("main");
    main.style.overflowX = "auto";
    main.style.overflowY = "auto";
    const grid = document.createElement("div");
    grid.style.overflowX = "auto";
    grid.style.overflowY = "auto";
    const cell = document.createElement("div");
    grid.append(cell);
    main.append(grid);
    document.body.append(main);

    box(
      main,
      { width: 960, height: 800, scrollWidth: 1136, scrollHeight: 2000 },
      { left: 0, top: 0 },
    );
    box(
      grid,
      { width: 600, height: 400, scrollWidth: 2000, scrollHeight: 1200 },
      { left: 100, top: 100 },
    );
    cell.getBoundingClientRect = () =>
      ({ left: 1000, top: 600, width: 100, height: 50 }) as DOMRect;

    scrollCellIntoView(cell);

    // 格子中心 1050 − 容器中心 400 = 650
    expect(grid.scrollLeft).toBe(650);
    expect(grid.scrollTop).toBe(325);
    expect(main.scrollLeft).toBe(0);
    expect(main.scrollTop).toBe(225);
    main.remove();
  });
});
