import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { composeEach, typeRaw } from "../test/field-input";
import { DateTimePicker, type PickerChangeDetails } from "./DateTimePicker";

/** MUI X 的日期時間欄位是一組「區段」包在 `role="group"` 裡,值從整組的文字讀。 */
const fieldText = () => screen.getByRole("group").textContent;

/** `onChange` 第二個參數:打到一半 / 清空或完成。 */
const PENDING = { isIncomplete: true };
const DONE = { isIncomplete: false };

/** 年 / 月 / 日 / 時區段(`role="spinbutton"`,名稱是 MUI 內建的英文)。 */
const section = (name: "Year" | "Month" | "Day" | "Hours") =>
  screen.getByRole("spinbutton", { name });

/** 受控往返:父層把 `onChange` 回來的字串存進 state 再傳回 `value`(台北時區輸入)。 */
const Controlled = ({
  initial,
  resetTo = null,
  onChange,
}: {
  initial: string | null;
  /** 「外部改值」按鈕要換成的值:模擬父層換成別的值(例如重設表單) */
  resetTo?: string | null;
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
      <DateTimePicker
        label="開始時間"
        value={value}
        timezone="Asia/Taipei"
        onChange={(next, details) => {
          onChange(next, details);
          setValue(next);
        }}
      />
    </>
  );
};

describe("DateTimePicker", () => {
  it("以指定時區顯示 UTC 時點(台北 +8、東京 +9),並掛上標籤", () => {
    const { rerender } = render(
      <DateTimePicker
        label="開始時間"
        value="2026-03-01T01:30:00Z"
        timezone="Asia/Taipei"
      />,
    );

    expect(fieldText()).toContain("2026-03-01 09:30");
    expect(screen.getAllByText("開始時間").length).toBeGreaterThan(0);

    rerender(
      <DateTimePicker
        label="開始時間"
        value="2026-03-01T01:30:00Z"
        timezone="Asia/Tokyo"
      />,
    );
    expect(fieldText()).toContain("2026-03-01 10:30");
  });

  it("沒有值時輸入格顯示格式提示", () => {
    render(<DateTimePicker label="值" value={null} timezone="UTC" />);

    expect(fieldText()).toContain("YYYY-MM-DD");
  });

  it("在日曆換一天:以該時區的同一個牆上時間換算,回報 UTC ISO(秒以下捨去)", () => {
    const handleChange = jest.fn();
    render(
      <DateTimePicker
        label="值"
        value="2026-03-01T01:30:00Z"
        timezone="Asia/Taipei"
        onChange={handleChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /choose date/i }));
    fireEvent.click(screen.getByRole("gridcell", { name: "15" }));

    expect(handleChange).toHaveBeenCalled();
    expect(handleChange.mock.calls[0]?.[0]).toBe("2026-03-15T01:30:00Z");
  });

  it("minDateTime 之前的日期不可選", () => {
    render(
      <DateTimePicker
        label="值"
        value="2026-03-10T00:00:00Z"
        minDateTime="2026-03-05T00:00:00Z"
        timezone="UTC"
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

  it("error + helperText 會渲染成錯誤提示", () => {
    render(
      <DateTimePicker
        label="值"
        value={null}
        timezone="UTC"
        error
        helperText="請選時間"
      />,
    );

    expect(screen.getByText("請選時間")).not.toBeNull();
  });
  it("hiddenLabel:不畫浮動標籤(legend 不留缺口),label 改當欄位的名稱", () => {
    const { container } = render(
      <DateTimePicker
        label="開始時間"
        hiddenLabel
        value="2026-03-01T01:30:00Z"
        timezone="Asia/Taipei"
      />,
    );

    // 沒有標籤元素、外框的 legend 只剩零寬空白:不留缺口
    expect(container.querySelector("label")).toBeNull();
    expect(container.querySelector("fieldset legend")?.textContent).toBe(
      "\u200B",
    );
    expect(screen.getByLabelText("開始時間")).toBe(screen.getByRole("group"));
  });

  describe("鍵盤逐位輸入(受控往返)", () => {
    it("年份逐位輸入 2026:每一鍵都留在區段裡,打滿 4 位才跳到月份、才送出完整時點", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(
        <Controlled initial="2025-03-15T01:30:00Z" onChange={handleChange} />,
      );

      await user.click(section("Year"));
      const typed: (string | null)[] = [];
      for (const key of "2026") {
        await user.keyboard(key);
        typed.push(section("Year").textContent);
      }

      expect(typed).toEqual(["0002", "0020", "0202", "2026"]);
      expect(section("Month")).toHaveFocus();
      const emitted = handleChange.mock.calls.map(([value]) => value);
      expect(emitted.at(-1)).toBe("2026-03-15T01:30:00Z");
      expect(emitted.slice(0, -1).every((value) => value === null)).toBe(true);
      expect(
        handleChange.mock.calls
          .slice(0, -1)
          .every(([, details]) => details.isIncomplete),
      ).toBe(true);
      expect(fieldText()).toContain("2026-03-15 09:30");
    });

    it("跨月改月份再改日、改小時:中途不合法送 null,完成後以台北牆上時間換算 UTC", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(
        <Controlled initial="2026-01-31T01:30:00Z" onChange={handleChange} />,
      );

      await user.click(section("Month"));
      await user.keyboard("02");
      expect(handleChange).toHaveBeenLastCalledWith(null, PENDING);

      await user.keyboard("28");
      expect(handleChange).toHaveBeenLastCalledWith(
        "2026-02-28T01:30:00Z",
        DONE,
      );

      await user.keyboard("14");
      expect(handleChange).toHaveBeenLastCalledWith(
        "2026-02-28T06:30:00Z",
        DONE,
      );
      expect(fieldText()).toContain("2026-02-28 14:30");
    });

    it("清空:全選刪除送出 null、顯示格式提示,之後可以重新逐位輸入", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(
        <Controlled initial="2026-01-31T01:30:00Z" onChange={handleChange} />,
      );

      await user.click(section("Year"));
      await user.keyboard("{Control>}a{/Control}{Backspace}");
      // 清空不是「打到一半」:篩選條件可以據此拿掉條件
      expect(handleChange).toHaveBeenLastCalledWith(null, DONE);
      expect(fieldText()).toContain("YYYY-MM-DD");

      // 全選狀態下區段暫時不是 spinbutton,直接打字從年份開始填
      await user.keyboard("202611050800");
      expect(handleChange).toHaveBeenLastCalledWith(
        "2026-11-05T00:00:00Z",
        DONE,
      );
    });

    it("外部換成別的值會覆蓋打到一半的草稿", async () => {
      const user = userEvent.setup();
      render(
        <Controlled
          initial="2025-03-15T01:30:00Z"
          resetTo="2030-05-06T02:00:00Z"
          onChange={jest.fn()}
        />,
      );

      await user.click(section("Year"));
      await user.keyboard("20");
      expect(section("Year").textContent).toBe("0020");

      await user.click(screen.getByRole("button", { name: "外部改值" }));
      expect(fieldText()).toContain("2030-05-06 10:00");
    });
  });

  /** MUI X 的組字、全形數字、NBSP 問題由 `useFieldInputGuard` 攔截(與 DatePicker 同一份)。 */
  describe("輸入法組字、全形數字、空白", () => {
    it.each(["compositionend", "insertText"] as const)(
      "注音逐鍵組字打 202611031830(%s):每個數字只套用一次",
      async (commitWith) => {
        const user = userEvent.setup();
        const handleChange = jest.fn();
        render(<Controlled initial={null} onChange={handleChange} />);

        await user.click(section("Year"));
        await composeEach("202611031830", commitWith);

        expect(handleChange).toHaveBeenLastCalledWith(
          "2026-11-03T10:30:00Z",
          DONE,
        );
        expect(fieldText()).toContain("2026-11-03 18:30");
      },
    );

    it("全形數字組字確認後當半形數字", async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Controlled initial={null} onChange={handleChange} />);

      await user.click(section("Year"));
      await composeEach("２０２６１１０３１８３０");

      expect(handleChange).toHaveBeenLastCalledWith(
        "2026-11-03T10:30:00Z",
        DONE,
      );
    });

    it("日期與時間之間打空白(Chromium 寫成 NBSP):2026-11-03 18:30 得到 18:30,不是 01:30", async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Controlled initial={null} onChange={handleChange} />);

      await user.click(section("Year"));
      typeRaw("2026-11-03\u00A018:30");

      expect(handleChange).toHaveBeenLastCalledWith(
        "2026-11-03T10:30:00Z",
        DONE,
      );
      expect(fieldText()).toContain("2026-11-03 18:30");
    });
  });
});
