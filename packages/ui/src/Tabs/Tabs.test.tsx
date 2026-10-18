import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tabs } from "./Tabs";

const items = [
  { value: "matrix", label: "權限設定" },
  { value: "users", label: "分配使用者" },
] as const;

describe("Tabs", () => {
  it("畫出一列 tab,選中的那個 aria-selected 為 true", () => {
    render(
      <Tabs
        value="matrix"
        items={items}
        aria-label="角色分頁"
        onChange={noop}
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "角色分頁" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "權限設定" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "分配使用者" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("點另一個 tab 回報它的 value(受控:自己不會換頁籤)", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Tabs value="matrix" items={items} onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "分配使用者" }));

    expect(onChange).toHaveBeenCalledWith("users");
    // 受控:沒有重新渲染就還是停在原本那個
    expect(screen.getByRole("tab", { name: "權限設定" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("disabled 的 tab 點下去不回報", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = jest.fn();
    render(
      <Tabs
        value="matrix"
        items={[
          items[0],
          { value: "users", label: "分配使用者", disabled: true },
        ]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "分配使用者" }));

    expect(screen.getByRole("tab", { name: "分配使用者" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  /** 資料換掉的瞬間 `value` 可能指到不存在的頁籤 —— 這時整列都不選中,而不是 MUI 警告。 */
  it("給了 id / aria-controls 就掛在 tab 上(呼叫端的 tabpanel 以 aria-labelledby 指回來)", () => {
    render(
      <Tabs
        value="matrix"
        items={[
          {
            value: "matrix",
            label: "權限設定",
            id: "t-matrix",
            "aria-controls": "p-matrix",
          },
        ]}
        onChange={noop}
      />,
    );

    const tab = screen.getByRole("tab", { name: "權限設定" });
    expect(tab).toHaveAttribute("id", "t-matrix");
    expect(tab).toHaveAttribute("aria-controls", "p-matrix");
  });

  it("value 不在 items 裡時沒有任何 tab 被選中", () => {
    render(<Tabs value="gone" items={items} onChange={noop} />);

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-selected", "false");
    }
  });
});

const manyItems = [
  "基本資料",
  "聯絡資訊",
  "合約",
  "附件",
  "審核紀錄",
  "修訂紀錄",
].map((label, index) => ({ value: `t${String(index)}`, label }));

/**
 * 「那一側還有沒有頁籤」是 MUI 用 IntersectionObserver 看第一個 / 最後一個頁籤得知的;
 * jsdom 沒有它,換成一個依 `visible` 回報的假 observer。
 */
const stubIntersection = (visible: { first: boolean; last: boolean }) => {
  class FakeIntersectionObserver {
    constructor(
      private readonly callback: (
        entries: Pick<IntersectionObserverEntry, "isIntersecting">[],
      ) => void,
    ) {}

    observe(target: Element) {
      const isFirst = target.previousElementSibling === null;
      this.callback([
        { isIntersecting: isFirst ? visible.first : visible.last },
      ]);
    }

    disconnect() {
      // 假 observer 沒有要清的東西
    }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: FakeIntersectionObserver,
  });
};

const scrollButtons = (container: HTMLElement) => [
  ...container.querySelectorAll(".MuiTabScrollButton-root"),
];

/** `scrollable`:放不下時單列捲動,還有頁籤的那一側才有 ‹ / ›(與漸層)。 */
describe("Tabs scrollable", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("預設不捲動:既有呼叫端的版面不變", () => {
    const { container } = render(
      <Tabs value="t0" items={manyItems} onChange={noop} />,
    );

    expect(container.querySelector(".MuiTabs-scrollableX")).toBeNull();
    expect(scrollButtons(container)).toHaveLength(0);
  });

  it("一開始(右邊還有):只有 › 可用,‹ 那一側沒有按鈕與漸層", () => {
    stubIntersection({ first: true, last: false });
    const { container } = render(
      <Tabs scrollable value="t0" items={manyItems} onChange={noop} />,
    );

    expect(container.querySelector(".MuiTabs-scrollableX")).not.toBeNull();
    const [start, end] = scrollButtons(container);
    expect(start).toHaveClass("Mui-disabled");
    expect(end).not.toHaveClass("Mui-disabled");
  });

  it("捲到中間(兩邊都有):‹ / › 都可用", () => {
    stubIntersection({ first: false, last: false });
    const { container } = render(
      <Tabs scrollable value="t3" items={manyItems} onChange={noop} />,
    );

    const [start, end] = scrollButtons(container);
    expect(start).not.toHaveClass("Mui-disabled");
    expect(end).not.toHaveClass("Mui-disabled");
  });

  /**
   * ‹ / › 出現時捲動區會變窄,MUI 掛載當下捲好的位置就不夠了(從網址打開最後一個頁籤會被擠出去);
   * 捲動區寬度一變就再把選中的頁籤捲進來(`useRevealSelectedTab`)。jsdom 沒有版面,幾何與 ResizeObserver 都是假的。
   */
  it("捲動區變窄(按鈕出現)→ 選中的頁籤再被捲進可視範圍", () => {
    let notifyResize = noop;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        notifyResize = callback;
      }

      observe() {
        // 由測試呼叫 notifyResize 模擬寬度改變
      }

      disconnect() {
        // 假 observer 沒有要清的東西
      }
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: FakeResizeObserver,
    });
    const { container } = render(
      <Tabs scrollable value="t5" items={manyItems} onChange={noop} />,
    );
    const scroller = container.querySelector<HTMLElement>(".MuiTabs-scroller");
    const selected = screen.getByRole("tab", { name: "修訂紀錄" });
    if (scroller === null) {
      throw new Error("scrollable 模式應有捲動區");
    }
    // 捲動區 212px 寬;選中的頁籤在內容 500–600px,目前捲了 156px → 右緣 444px 超出
    let scrollLeft = 156;
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });
    scroller.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 0, width: 212, height: 40 });
    selected.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 500 - scrollLeft, y: 0, width: 100, height: 40 });

    notifyResize();

    expect(scrollLeft).toBe(388);
    expect(selected.getBoundingClientRect().right).toBe(212);
  });

  it("全部放得下:不出現按鈕", () => {
    stubIntersection({ first: true, last: true });
    const { container } = render(
      <Tabs scrollable value="matrix" items={items} onChange={noop} />,
    );

    expect(scrollButtons(container)).toHaveLength(0);
  });
});

const noop = () => {
  // 受控元件必給 onChange;這幾個案子不驗回報
};
