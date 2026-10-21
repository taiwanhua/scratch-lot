import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

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
  const [height, setTarget] = useFitMainHeight();
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

/** <main> 上緣 100、可見高 `mainHeight`、下內距 24;排班表根節點下緣 = 區塊下緣 + 圖例 80。 */
const renderInMain = (mainHeight: number) =>
  render(
    <main
      ref={placeAt(100, 100 + mainHeight, mainHeight)}
      style={{ paddingBottom: "24px" }}
    >
      <div ref={placeAt(150, 880)} data-roster-root="">
        <Probe />
      </div>
    </main>,
  );

describe("useFitMainHeight:內層捲動區塊的高度 = <main> 扣掉同頁其他內容", () => {
  it("扣掉上方(工具列)、下方(圖例)與 <main> 下內距:700 − 200 − 80 − 24 = 396", () => {
    renderInMain(700);
    expect(screen.getByTestId("target")).toHaveAttribute("data-height", "396");
  });

  it("剩下的空間不到下限(240)→ 不設上限,整頁只由 <main> 捲", () => {
    renderInMain(400);
    expect(screen.getByTestId("target")).toHaveAttribute("data-height", "none");
  });
});
