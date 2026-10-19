import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { Switch } from "./Switch";

const label = "啟用";

describe("Switch", () => {
  it("渲染出一個開關,預設關閉", () => {
    render(<Switch slotProps={{ input: { "aria-label": label } }} />);

    expect(screen.getByRole("switch", { name: label })).not.toBeChecked();
  });

  it("點擊會打開並回報 onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Switch
        slotProps={{ input: { "aria-label": label } }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("switch", { name: label }));

    expect(screen.getByRole("switch", { name: label })).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /**
   * 幾何覆寫曾把 MUI 的 `.Mui-disabled` 灰化一起蓋掉,
   * 開關按不動卻還是彩色的。這兩案盯的就是「看得出來是停用的」。
   */
  it("disabled 時點擊不觸發 onChange", async () => {
    // MUI 對停用的 switchBase 下 pointer-events: none,user-event 預設會先擋下點擊;
    // 這裡要驗的是「真的點下去也不會有事」(TEST-09)
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = jest.fn();
    render(
      <Switch
        disabled
        slotProps={{ input: { "aria-label": label } }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("switch", { name: label }));

    expect(screen.getByRole("switch", { name: label })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled 時軌道與把手都換成停用色,而不是只靠 opacity", () => {
    const { container } = render(
      <Switch disabled slotProps={{ input: { "aria-label": label } }} />,
    );
    const root = container.querySelector(".MuiSwitch-root");
    if (root === null) {
      throw new Error("找不到開關");
    }
    const ownClass = `.${emotionClassOf(root)}`;

    const enabledTrack = declaredValue(
      cssRulesMatching(`${ownClass} .MuiSwitch-track`),
      "background-color",
    );
    const disabledTrack = declaredValue(
      cssRulesMatching(ownClass, ".Mui-disabled", "+.MuiSwitch-track"),
      "background-color",
    );
    const disabledThumb = declaredValue(
      cssRulesMatching(ownClass, ".Mui-disabled .MuiSwitch-thumb"),
      "color",
    );

    expect(disabledTrack).not.toBeNull();
    expect(disabledTrack).not.toBe(enabledTrack);
    expect(disabledThumb).not.toBeNull();
    // 灰化靠顏色、不靠淡化 —— 幾何覆寫寫死的 opacity: 1 才不會又把 MUI 的淡化吃掉
    expect(
      declaredValue(
        cssRulesMatching(ownClass, ".Mui-disabled", "+.MuiSwitch-track"),
        "opacity",
      ),
    ).toBe("1");
  });

  it("受控模式下值由外部決定,點擊不會自行翻轉", async () => {
    const user = userEvent.setup();
    render(
      <Switch
        checked
        slotProps={{ input: { "aria-label": label } }}
        onChange={jest.fn()}
      />,
    );

    await user.click(screen.getByRole("switch", { name: label }));

    expect(screen.getByRole("switch", { name: label })).toBeChecked();
  });
});
