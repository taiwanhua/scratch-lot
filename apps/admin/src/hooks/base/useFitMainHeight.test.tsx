import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import { Profiler } from "react";

import { useFitMainHeight } from "./useFitMainHeight";

/** jsdom 不做版面:在節點掛上時給它量測用的幾何(上緣、下緣、可見高)。 */
const placeAt =
  (top: number, bottom: number, clientHeight = 0) =>
  (element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        DOMRect.fromRect({ x: 0, y: top, width: 0, height: bottom - top }),
    });
    Object.defineProperty(element, "clientHeight", {
      configurable: true,
      value: clientHeight,
    });
  };

const Probe = () => {
  const [height, setTarget] = useFitMainHeight({
    boundarySelector: "[data-fit-boundary]",
  });
  // 捲動區塊外層:上緣 300、高 500
  const place = placeAt(300, 800);
  return (
    <div
      ref={(element) => {
        place(element);
        setTarget(element);
      }}
      data-testid="target"
      data-height={height === null ? "none" : String(height)}
    />
  );
};

/** 畫了幾次(<Profiler> 每次 commit 記一次):重算不該一直觸發重畫。 */
let renders = 0;
const countRender = () => {
  renders += 1;
};

/**
 * <main> 上緣 100、可見高 `mainHeight`、下內距 24;內容欄(邊界)下緣 = 區塊下緣 + 圖例 80;
 * 旁邊並排一塊比內容高的側欄(下緣 1400),不在邊界裡。
 */
const renderInMain = (mainHeight: number) =>
  render(
    <Profiler id="probe" onRender={countRender}>
      <main
        ref={placeAt(100, 100 + mainHeight, mainHeight)}
        style={{ paddingBottom: "24px" }}
      >
        <div ref={placeAt(150, 1400)}>
          <div ref={placeAt(150, 880)} data-fit-boundary="">
            <Probe />
          </div>
          <aside ref={placeAt(150, 1400)} />
        </div>
      </main>
    </Profiler>,
  );

/** 收下 ResizeObserver 的回呼,測試自己觸發(模擬版面改變後重算)。 */
const observed: ResizeObserverCallback[] = [];
const originalObserver = globalThis.ResizeObserver;

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    observed.push(callback);
  }
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

describe("useFitMainHeight:內層捲動區塊的高度 = <main> 扣掉同頁其他內容", () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalObserver;
    observed.length = 0;
  });

  it("扣掉上方(工具列)、下方(圖例)與 <main> 下內距:700 − 200 − 80 − 24 = 396", () => {
    renderInMain(700);
    expect(screen.getByTestId("target")).toHaveAttribute("data-height", "396");
  });

  it("剩下的空間不到下限(240)→ 不設上限,整頁只由 <main> 捲", () => {
    renderInMain(400);
    expect(screen.getByTestId("target")).toHaveAttribute("data-height", "none");
  });

  it("旁邊的側欄比內容高:只量邊界(內容欄),高度不變、重算不會反覆更新", () => {
    globalThis.ResizeObserver = ResizeObserverStub;
    renders = 0;
    renderInMain(700);
    expect(screen.getByTestId("target")).toHaveAttribute("data-height", "396");
    const settled = renders;
    expect(observed).toHaveLength(1);
    act(() => {
      for (let i = 0; i < 5; i += 1) {
        observed[0]?.([], {} as ResizeObserver);
      }
    });
    expect(screen.getByTestId("target")).toHaveAttribute("data-height", "396");
    expect(renders).toBe(settled);
  });
});
