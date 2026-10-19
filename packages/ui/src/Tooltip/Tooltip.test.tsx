import { describe, expect, it } from "@jest/globals";
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { Tooltip } from "./Tooltip";

const hint = "平台根組織不可停用";

describe("Tooltip", () => {
  it("滑過元素時出現提示,移開後收起", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip title={hint}>
        <Button>停用</Button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button", { name: "停用" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);

    await user.unhover(screen.getByRole("button", { name: "停用" }));

    // 收起有淡出動畫,節點要等一下才真的拆掉
    await waitForElementToBeRemoved(() => screen.queryByRole("tooltip"));
  });

  it("鍵盤聚焦也會出現提示", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip title={hint}>
        <Button>停用</Button>
      </Tooltip>,
    );

    await user.tab();

    expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);
  });

  /**
   * 重點:disabled 的元素不發滑鼠事件(瀏覽器行為),
   * 提示必須掛在外層的 span 上 —— 這一層以前在每個呼叫端各寫一次。
   */
  it("disabled 的元素照樣提示得出來", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <Tooltip title={hint}>
        <Button disabled>停用</Button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "停用" });

    expect(button).toBeDisabled();
    // 事件載體是外層的 span,不是按鈕本身
    const wrapper = button.parentElement;
    if (wrapper === null) {
      throw new Error("disabled 的元素沒有被包在 span 裡");
    }
    await user.hover(wrapper);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);
  });

  it("可用的元素不多包一層,無障礙關聯留在元素自己身上", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip title={hint}>
        <Button>停用</Button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "停用" });

    await user.hover(button);
    const tooltip = await screen.findByRole("tooltip");

    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("title 是空的就不提示", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip title="">
        <Button>停用</Button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button", { name: "停用" }));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
