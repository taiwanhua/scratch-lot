import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MODULE_ICONS, MODULE_ICON_KEYS } from "../icons/module-icon-registry";
import { ModuleIconPicker } from "./ModuleIconPicker";

/** 下拉的觸發區(MUI 的 `TextField select` 是一顆 combobox)。 */
const trigger = () => screen.getByRole("combobox");

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(trigger());
  return screen.getByRole("listbox");
};

describe("ModuleIconPicker", () => {
  it("收合時顯示目前選中的圖示與短詞", () => {
    render(<ModuleIconPicker label="圖示" value="people" />);

    expect(trigger()).toHaveTextContent(MODULE_ICONS.people.label);
    expect(trigger().querySelector("svg")).not.toBeNull();
    expect(screen.getAllByText("圖示").length).toBeGreaterThan(0);
  });

  it("展開後列出白名單全部 30 個選項,每個都有圖示", async () => {
    const user = userEvent.setup();
    render(<ModuleIconPicker label="圖示" value="people" />);

    const listbox = await openMenu(user);
    const options = within(listbox).getAllByRole("option");

    expect(options).toHaveLength(MODULE_ICON_KEYS.length);
    expect(options).toHaveLength(30);
    for (const [index, key] of MODULE_ICON_KEYS.entries()) {
      const option = options[index];
      expect(option).toHaveTextContent(MODULE_ICONS[key].label);
      expect(option?.querySelector("svg")).not.toBeNull();
    }
  });

  it("選一個圖示會以白名單的 key 回報(受控:自己不改值)", async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(
      <ModuleIconPicker label="圖示" value="people" onChange={handleChange} />,
    );

    const listbox = await openMenu(user);
    await user.click(within(listbox).getByText(MODULE_ICONS.calendar.label));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange).toHaveBeenCalledWith("calendar");
    // 受控元件:沒有換 props 之前,畫面留在舊值
    expect(trigger()).toHaveTextContent(MODULE_ICONS.people.label);
  });

  it("換 value 就換顯示(受控切換)", () => {
    const { rerender } = render(
      <ModuleIconPicker label="圖示" value="people" />,
    );
    expect(trigger()).toHaveTextContent(MODULE_ICONS.people.label);

    rerender(<ModuleIconPicker label="圖示" value="store" />);

    expect(trigger()).toHaveTextContent(MODULE_ICONS.store.label);
    expect(trigger()).not.toHaveTextContent(MODULE_ICONS.people.label);
  });

  it.each([
    ["未設定", null],
    ["舊資料留下的未知 key", "no-such-icon"],
  ])("%s 時畫預設圖示 + emptyLabel", (_case, value) => {
    render(<ModuleIconPicker label="圖示" value={value} emptyLabel="未設定" />);

    expect(trigger()).toHaveTextContent("未設定");
    expect(trigger().querySelector("svg")).not.toBeNull();
  });

  it("`labelOf` 覆寫顯示名稱(i18n 用),沒回值的退回登錄表", async () => {
    const user = userEvent.setup();
    render(
      <ModuleIconPicker
        label="Icon"
        value="people"
        labelOf={(key) => (key === "people" ? "Users" : undefined)}
      />,
    );

    expect(trigger()).toHaveTextContent("Users");

    const listbox = await openMenu(user);
    expect(within(listbox).getByText("Users")).not.toBeNull();
    expect(
      within(listbox).getByText(MODULE_ICONS.calendar.label),
    ).not.toBeNull();
  });

  it("disabled 時點不開、也不回報", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const handleChange = jest.fn();
    render(
      <ModuleIconPicker
        label="圖示"
        value="people"
        disabled
        onChange={handleChange}
      />,
    );

    await user.click(trigger());

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(handleChange).not.toHaveBeenCalled();
  });

  /**
   * #297:放進「左標籤 + 右內容」版型時不會給 `label`,combobox 於是沒有無障礙名稱。
   * 兩條直通管道各驗一次。
   */
  it("沒有 label 時,aria-label 就是 combobox 的無障礙名稱", () => {
    render(<ModuleIconPicker value="people" aria-label="圖示" />);

    expect(screen.getByRole("combobox", { name: "圖示" })).not.toBeNull();
  });

  it("labelId 指向版型自己那顆標籤時,名稱取自該標籤", () => {
    render(
      <>
        <span id="icon-field-label">圖示</span>
        <ModuleIconPicker value="people" labelId="icon-field-label" />
      </>,
    );

    expect(screen.getByRole("combobox", { name: "圖示" })).not.toBeNull();
  });

  it("error + helperText 會渲染成錯誤提示", () => {
    render(
      <ModuleIconPicker
        label="圖示"
        value={null}
        error
        helperText="請選圖示"
      />,
    );

    expect(screen.getByText("請選圖示")).not.toBeNull();
  });
});
