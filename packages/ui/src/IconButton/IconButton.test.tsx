import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { IconButton } from "./IconButton";

const label = "關閉";

describe("IconButton", () => {
  it("以 aria-label 當無障礙名稱,點擊會回報", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(
      <IconButton aria-label={label} size="small" onClick={onClick}>
        <span>×</span>
      </IconButton>,
    );

    await user.click(screen.getByRole("button", { name: label }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled 時點擊不觸發 onClick", async () => {
    // MUI 對停用的 ButtonBase 下 pointer-events: none,user-event 預設會先擋下點擊(TEST-09)
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onClick = jest.fn();
    render(
      <IconButton aria-label={label} disabled onClick={onClick}>
        <span>×</span>
      </IconButton>,
    );

    await user.click(screen.getByRole("button", { name: label }));

    expect(screen.getByRole("button", { name: label })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * 側欄收合開關原本在呼叫端用 `sx` 畫外框與 40×40(STYLE-10 記錄在案的例外)。
   * 變體補上後那些幾何要由元件自己給,呼叫端只剩 `variant="outlined"`。
   */
  it("variant=outlined:外框與正方形幾何由元件給,不必呼叫端傳 sx", () => {
    render(
      <IconButton aria-label={label} variant="outlined">
        <span>×</span>
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: label });
    const rules = cssRulesMatching(`.${emotionClassOf(button)}`);

    expect(declaredValue(rules, "width")).toBe("40px");
    expect(declaredValue(rules, "height")).toBe("40px");
    expect(declaredValue(rules, "border")).toMatch(/^1px solid /);
    // `variant` 是本包裝層自己的 prop,不可以漏到 DOM
    expect(button).not.toHaveAttribute("variant");
  });

  it("variant=outlined 的邊長跟著 size 走(small 32)", () => {
    render(
      <IconButton aria-label={label} variant="outlined" size="small">
        <span>×</span>
      </IconButton>,
    );
    const rules = cssRulesMatching(
      `.${emotionClassOf(screen.getByRole("button", { name: label }))}`,
    );

    expect(declaredValue(rules, "width")).toBe("32px");
  });

  it("預設(plain)沒有外框,維持 MUI 原本的圖示鈕", () => {
    render(
      <IconButton aria-label={label}>
        <span>×</span>
      </IconButton>,
    );
    const rules = cssRulesMatching(
      `.${emotionClassOf(screen.getByRole("button", { name: label }))}`,
    );

    // MUI 自己的 IconButton 底樣式是 `border: 0`;我們沒有再加框,也沒有固定邊長
    expect(declaredValue(rules, "border")).toBe("0");
    expect(declaredValue(rules, "width")).toBeNull();
  });

  /**
   * 呼叫端常給 `sx={{ color: … }}`(AppBar 的「?」就是),
   * 那個值不可以把停用色蓋掉 —— 停用的圖示鈕必須看得出來是灰的。
   */
  it("呼叫端的 sx.color 蓋不掉停用色", () => {
    render(
      <IconButton aria-label={label} disabled sx={{ color: "text.secondary" }}>
        <span>×</span>
      </IconButton>,
    );
    const ownClass = `.${emotionClassOf(screen.getByRole("button", { name: label }))}`;

    const baseColor = declaredValue(
      cssRulesMatching(ownClass).filter(
        (rule) => rule.selectorText === ownClass,
      ),
      "color",
    );
    const disabledColor = declaredValue(
      cssRulesMatching(`${ownClass}.Mui-disabled`),
      "color",
    );

    expect(disabledColor).not.toBeNull();
    expect(disabledColor).not.toBe(baseColor);
  });
});
