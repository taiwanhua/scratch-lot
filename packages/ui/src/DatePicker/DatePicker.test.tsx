import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { DatePicker, type PickerChangeDetails } from "./DatePicker";

/**
 * 輸入格:MUI X 的日期欄位是一組「區段」(年 / 月 / 日各一個 span)包在 `role="group"` 裡,
 * 不是單一個 `textbox`,所以值要從整組的文字讀。
 */
const field = () => screen.getByRole("group");

/** 區段組的文字(尾巴會帶上 `fieldset` 的 legend 標籤,所以用 contains 比對)。 */
const fieldText = () => field().textContent;

/** `onChange` 第二個參數:打到一半 / 清空或完成。 */
const PENDING = { isIncomplete: true };
const DONE = { isIncomplete: false };

/** 年 / 月 / 日區段(`role="spinbutton"`,名稱是 MUI 內建的英文)。 */
const section = (name: "Year" | "Month" | "Day") =>
  screen.getByRole("spinbutton", { name });

/**
 * 真實呼叫端的寫法:父層把 `onChange` 回來的字串存進 state 再傳回 `value`(受控往返)。
 * 打字途中送出的 `null` 也會原樣回到 `value`,區段不能因此被重建。
 */
const Controlled = ({
  initial,
  resetTo = null,
  storeNullAsEmpty = false,
  onChange,
}: {
  initial: string | null;
  /** 「外部改值」按鈕要換成的值:模擬父層換成別的值(例如重設表單) */
  resetTo?: string | null;
  /** 模擬把清空存成空字串的呼叫端(`value ?? ""`) */
  storeNullAsEmpty?: boolean;
  onChange: (value: string | null, details: PickerChangeDetails) => void;
}) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValue(resetTo);
        }}
      >
        外部改值
      </button>
      <DatePicker
        label="期初日期"
        value={value}
        onChange={(next, details) => {
          onChange(next, details);
          setValue(storeNullAsEmpty ? (next ?? "") : next);
        }}
      />
    </>
  );
};

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

  describe("鍵盤逐位輸入(受控往返)", () => {
    it("年份逐位輸入 2026:每一鍵都留在區段裡,打滿 4 位才跳到月份、才送出完整日期", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(<Controlled initial="2025-03-15" onChange={handleChange} />);

      await user.click(section("Year"));
      const typed: (string | null)[] = [];
      for (const key of "2026") {
        await user.keyboard(key);
        typed.push(section("Year").textContent);
      }

      expect(typed).toEqual(["0002", "0020", "0202", "2026"]);
      expect(section("Month")).toHaveFocus();
      // 年份沒打滿 4 位不往外送日期(`0202` 雖然是合法日期,但不是使用者要的值);
      // MUI 只在值有變時才回呼,所以中途是幾次 `null` 不重要,重要的是沒有送出別的日期
      const emitted = handleChange.mock.calls.map(([value]) => value);
      expect(emitted.at(-1)).toBe("2026-03-15");
      expect(emitted.slice(0, -1).every((value) => value === null)).toBe(true);
      expect(
        handleChange.mock.calls
          .slice(0, -1)
          .every(([, details]) => details.isIncomplete),
      ).toBe(true);
      expect(fieldText()).toContain("2026-03-15");
    });

    it("跨月改月份:1/31 改成 2 月先送 null(不合法),日改成 28 才送出 2026-02-28", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(<Controlled initial="2026-01-31" onChange={handleChange} />);

      await user.click(section("Month"));
      await user.keyboard("02");
      expect(section("Month").textContent).toBe("02");
      expect(section("Day")).toHaveFocus();
      expect(handleChange).toHaveBeenLastCalledWith(null, PENDING);

      await user.keyboard("28");
      expect(handleChange).toHaveBeenLastCalledWith("2026-02-28", DONE);
      expect(fieldText()).toContain("2026-02-28");
    });

    it("清空:全選刪除送出 null、顯示格式提示,之後可以重新逐位輸入", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(<Controlled initial="2026-01-31" onChange={handleChange} />);

      await user.click(section("Year"));
      await user.keyboard("{Control>}a{/Control}{Backspace}");
      // 清空不是「打到一半」:篩選條件可以據此拿掉條件
      expect(handleChange).toHaveBeenLastCalledWith(null, DONE);
      expect(fieldText()).toContain("YYYY-MM-DD");

      // 全選狀態下區段暫時不是 spinbutton,直接打字從年份開始填
      await user.keyboard("20261105");
      expect(handleChange).toHaveBeenLastCalledWith("2026-11-05", DONE);
      expect(fieldText()).toContain("2026-11-05");
    });

    it("外部換成別的值會覆蓋打到一半的草稿", async () => {
      const user = userEvent.setup();
      render(
        <Controlled
          initial="2025-03-15"
          resetTo="2030-05-06"
          onChange={jest.fn()}
        />,
      );

      await user.click(section("Year"));
      await user.keyboard("20");
      expect(section("Year").textContent).toBe("0020");

      await user.click(screen.getByRole("button", { name: "外部改值" }));
      expect(fieldText()).toContain("2030-05-06");
    });

    it("父層把 null 存成空字串再傳回時,年份逐位輸入不會清掉月、日", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(
        <Controlled
          initial="2025-03-15"
          storeNullAsEmpty
          onChange={handleChange}
        />,
      );

      await user.click(section("Year"));
      const typed: (string | null)[] = [];
      for (const key of "2026") {
        await user.keyboard(key);
        typed.push(section("Year").textContent);
      }

      expect(typed).toEqual(["0002", "0020", "0202", "2026"]);
      expect(handleChange).toHaveBeenLastCalledWith("2026-03-15", DONE);
      expect(fieldText()).toContain("2026-03-15");
    });

    it("父層沒接受變更(值不變)時,畫面回到父層的值", async () => {
      const user = userEvent.setup();
      render(<DatePicker label="值" value="2026-01-31" onChange={jest.fn()} />);

      await user.click(section("Day"));
      await user.keyboard("15");
      expect(fieldText()).toContain("2026-01-31");
    });
  });
});
