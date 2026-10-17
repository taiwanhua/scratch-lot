import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
  mediaRulesMatching,
} from "../test/css-rules";
import { SnackbarStack, type SnackbarStackItem } from "./SnackbarStack";
import { SNACKBAR_MAX_VISIBLE, enqueueSnackbar } from "./snackbar-queue";

const noop = () => {
  // 這個案子不驗關閉
};

const stackOf = (): HTMLElement => {
  const stack = document.querySelector<HTMLElement>("[data-snackbar-stack]");
  if (stack === null) {
    throw new Error("找不到提示堆疊");
  }
  return stack;
};

const messagesOnScreen = (): string[] =>
  within(stackOf())
    .getAllByRole("alert")
    .map((alert) => alert.textContent);

describe("enqueueSnackbar(堆疊規則)", () => {
  it("新的一則放在最後(畫面最下面),舊的往上推", () => {
    expect(enqueueSnackbar(["A"], "B")).toEqual(["A", "B"]);
  });

  it("最多 3 則:第 4 則出現時最舊的那則消失,維持 3 則", () => {
    expect(SNACKBAR_MAX_VISIBLE).toBe(3);
    expect(enqueueSnackbar(["A", "B", "C"], "D")).toEqual(["B", "C", "D"]);
  });

  it("不改動傳入的陣列", () => {
    const items = ["A"] as const;
    enqueueSnackbar(items, "B");
    expect(items).toEqual(["A"]);
  });
});

describe("SnackbarStack", () => {
  it("沒有任何一則時不渲染容器", () => {
    render(<SnackbarStack items={[]} closeLabel="關閉" onClose={noop} />);

    expect(document.querySelector("[data-snackbar-stack]")).toBeNull();
  });

  it("由舊到新往下排:新的在最下面", () => {
    const items: SnackbarStackItem[] = [
      { id: 1, message: "已儲存" },
      { id: 2, severity: "info", title: "新通知", message: "你有 1 則新通知" },
    ];
    render(<SnackbarStack items={items} closeLabel="關閉" onClose={noop} />);

    expect(messagesOnScreen()).toEqual(["已儲存", "新通知你有 1 則新通知"]);
  });

  it("就算給超過 3 則,也只畫最新的 3 則", () => {
    const items: SnackbarStackItem[] = ["A", "B", "C", "D"].map(
      (message, index) => ({ id: index, message }),
    );
    render(<SnackbarStack items={items} closeLabel="關閉" onClose={noop} />);

    expect(messagesOnScreen()).toEqual(["B", "C", "D"]);
  });

  it("按某一則的 ✕ 回報那一則的 id", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <SnackbarStack
        items={[
          { id: "a", message: "第一則" },
          { id: "b", message: "第二則" },
        ]}
        closeLabel="關閉"
        onClose={onClose}
      />,
    );

    const [first] = within(stackOf()).getAllByRole("alert");
    if (first === undefined) {
      throw new Error("沒有第一則");
    }
    await user.click(within(first).getByRole("button", { name: "關閉" }));

    expect(onClose).toHaveBeenCalledWith("a");
  });

  /**
   * 位置:jsdom 不算版面,直接讀 emotion 寫出的規則(TEST-09)。
   * 手機(xs)底部、左右 16 滿寬;`sm` 以上右下角距邊 24、寬 360。
   */
  it("手機底部左右 16 滿寬;電腦 / 平板右下角距邊 24", () => {
    render(
      <SnackbarStack
        items={[{ id: 1, message: "已儲存" }]}
        closeLabel="關閉"
        onClose={noop}
      />,
    );

    const className = emotionClassOf(stackOf());
    expect(declaredValue(cssRulesMatching(className), "position")).toBe(
      "fixed",
    );
    const mobile = mediaRulesMatching("min-width:0px", className);
    expect(declaredValue(mobile, "left")).toBe("16px");
    expect(declaredValue(mobile, "right")).toBe("16px");
    expect(declaredValue(mobile, "bottom")).toBe("16px");

    const desktop = mediaRulesMatching("min-width:600px", className);
    expect(declaredValue(desktop, "left")).toBe("auto");
    expect(declaredValue(desktop, "right")).toBe("24px");
    expect(declaredValue(desktop, "bottom")).toBe("24px");
    expect(declaredValue(desktop, "width")).toBe("360px");
  });

  it("手機有底部導覽時放在它上面(mobileBottomOffset)", () => {
    render(
      <SnackbarStack
        items={[{ id: 1, message: "已儲存" }]}
        closeLabel="關閉"
        onClose={noop}
        mobileBottomOffset={7}
      />,
    );

    const mobile = mediaRulesMatching(
      "min-width:0px",
      emotionClassOf(stackOf()),
    );
    // 16 + 底部導覽 56(7 個 spacing 單位)
    expect(declaredValue(mobile, "bottom")).toBe("72px");
  });

  it("容器不擋下面的畫面(pointer-events: none),卡片自己可以點", () => {
    render(
      <SnackbarStack
        items={[{ id: 1, message: "已儲存" }]}
        closeLabel="關閉"
        onClose={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "關閉" })).toBeEnabled();
    const base = cssRulesMatching(emotionClassOf(stackOf()));
    expect(declaredValue(base, "pointer-events")).toBe("none");
  });
});
