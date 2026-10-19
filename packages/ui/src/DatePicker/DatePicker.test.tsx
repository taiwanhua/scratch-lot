import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { DatePicker } from "./DatePicker";

/**
 * 輸入格:MUI X 的日期欄位是一組「區段」(年 / 月 / 日各一個 span)包在 `role="group"` 裡,
 * 不是單一個 `textbox`,所以值要從整組的文字讀。
 */
const field = () => screen.getByRole("group");

/** 區段組的文字(尾巴會帶上 `fieldset` 的 legend 標籤,所以用 contains 比對)。 */
const fieldText = () => field().textContent;

describe("DatePicker", () => {
  it("以 YYYY-MM-DD 顯示傳入的值,並掛上標籤", () => {
    render(<DatePicker label="值" value="2026-01-01" />);

    expect(fieldText()).toContain("2026-01-01");
    expect(screen.getAllByText("值").length).toBeGreaterThan(0);
  });

  it("沒有值時輸入格顯示格式提示", () => {
    render(<DatePicker label="值" value={null} />);

    expect(fieldText()).toContain("YYYY-MM-DD");
  });

  it("在日曆選一天後,以 YYYY-MM-DD 字串回報", () => {
    const handleChange = jest.fn();
    render(
      <DatePicker label="值" value="2026-01-01" onChange={handleChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose date/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: "15" }));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(handleChange.mock.calls[0]?.[0]).toBe("2026-01-15");
  });

  it("minDate / maxDate 之外的日期不可選", () => {
    render(
      <DatePicker
        label="值"
        value="2026-01-10"
        minDate="2026-01-05"
        maxDate="2026-01-20"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose date/i }));

    expect(
      screen.getByRole("gridcell", { name: "1" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(
      screen.getByRole("gridcell", { name: "10" }).getAttribute("disabled"),
    ).toBeNull();
  });

  /**
   * 沒有 `size` 時固定 medium,在 `size="small"` 的下拉旁邊高一截。
   * MUI X 的日期欄不是一般的 `InputBase`,尺寸落在 `MuiPickersInputBase-inputSizeSmall`
   * 與標籤 / 圖示的 `sizeSmall` 上。
   */
  it('size="small" 會把尺寸透傳給輸入格、標籤與日曆圖示', () => {
    const { container } = render(
      <DatePicker label="值" value="2026-01-01" size="small" />,
    );

    expect(
      container.querySelector(".MuiPickersInputBase-inputSizeSmall"),
    ).toBeInTheDocument();
    expect(container.querySelector(".MuiInputLabel-sizeSmall")).not.toBeNull();
    expect(
      container.querySelector(".MuiInputAdornment-sizeSmall"),
    ).not.toBeNull();
  });

  it("不給 size 時維持 medium", () => {
    const { container } = render(<DatePicker label="值" value="2026-01-01" />);

    expect(
      container.querySelector(".MuiPickersInputBase-inputSizeSmall"),
    ).toBeNull();
    expect(
      container.querySelector(".MuiInputAdornment-sizeMedium"),
    ).not.toBeNull();
  });

  it("error + helperText 會渲染成錯誤提示", () => {
    render(
      <DatePicker label="值" value="2026-01-01" error helperText="請選日期" />,
    );

    expect(screen.getByText("請選日期")).not.toBeNull();
  });
  it("hiddenLabel:不畫浮動標籤(legend 不留缺口),label 改當欄位的名稱", () => {
    const { container } = render(
      <DatePicker label="起日" hiddenLabel value="2026-01-01" />,
    );

    // 沒有標籤元素、外框的 legend 只剩零寬空白:不留缺口
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector("fieldset legend")?.textContent).toBe(
      "\u200B",
    );
    expect(screen.getByLabelText("起日")).toBe(field());
  });
});
