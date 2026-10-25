import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { compose, composeEach, typeRaw } from "../test/field-input";
import { type PickerChangeDetails, TimePicker } from "./TimePicker";

/** 輸入格:MUI X 的欄位是一組「區段」(時 / 分各一個 span)包在 `role="group"` 裡。 */
const field = () => screen.getByRole("group");

/** 區段組的文字(尾巴會帶上 `fieldset` 的 legend 標籤,所以用 contains 比對)。 */
const fieldText = () => field().textContent;

const DONE = { isIncomplete: false };

/** 時 / 分區段(`role="spinbutton"`,名稱是 MUI 內建的英文)。 */
const section = (name: "Hours" | "Minutes") =>
  screen.getByRole("spinbutton", { name });

/** 真實呼叫端的寫法:父層把 `onChange` 回來的字串存進 state 再傳回 `value`(受控往返)。 */
const Controlled = ({
  initial,
  resetTo = null,
  minutesStep,
  onChange,
}: {
  initial: string | null;
  resetTo?: string | null;
  minutesStep?: number;
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
      <TimePicker
        label="開始"
        value={value}
        minutesStep={minutesStep}
        onChange={(next, details) => {
          onChange(next, details);
          setValue(next);
        }}
      />
    </>
  );
};

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: /choose time/i }));
};

describe("TimePicker", () => {
  it("以 24 小時制 HH:mm 顯示傳入的值,並掛上標籤", () => {
    render(<TimePicker label="開始" value="21:30" />);

    expect(fieldText()).toContain("21:30");
    expect(screen.getAllByText("開始").length).toBeGreaterThan(0);
  });

  it("沒有值時輸入格顯示格式提示", () => {
    render(<TimePicker label="開始" value={null} />);

    expect(fieldText()).toContain("hh:mm");
  });

  it("從選單挑時、分,以 HH:mm 字串回報", () => {
    const handleChange =
      jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
    render(<Controlled initial="09:00" onChange={handleChange} />);

    openMenu();
    const [hours, minutes] = screen.getAllByRole("listbox");
    if (hours === undefined || minutes === undefined) {
      throw new Error("沒有時 / 分選單");
    }
    fireEvent.click(within(hours).getByRole("option", { name: "14 hours" }));
    expect(handleChange).toHaveBeenLastCalledWith("14:00", DONE);
    fireEvent.click(
      within(minutes).getByRole("option", { name: "45 minutes" }),
    );
    expect(handleChange).toHaveBeenLastCalledWith("14:45", DONE);
  });

  it("minutesStep:選單的分鐘只列格子上的分鐘", () => {
    render(<TimePicker label="開始" value="09:00" minutesStep={15} />);

    openMenu();
    const minutes = screen.getAllByRole("listbox")[1];
    if (minutes === undefined) throw new Error("沒有分鐘選單");
    const options = within(minutes)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["00", "15", "30", "45"]);
  });

  it("minutesStep:鍵盤打出不在格子上的時間,照打的值回傳、欄位標紅", async () => {
    const user = userEvent.setup();
    const handleChange =
      jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
    const { container } = render(
      <Controlled initial="09:00" minutesStep={15} onChange={handleChange} />,
    );

    await user.click(section("Minutes"));
    await user.keyboard("10");

    expect(handleChange).toHaveBeenLastCalledWith("09:10", DONE);
    expect(container.querySelector(".Mui-error")).not.toBeNull();
  });

  it("minTime / maxTime 之外的時刻在選單上不可選", () => {
    render(
      <TimePicker label="開始" value="10:00" minTime="08:00" maxTime="18:00" />,
    );

    openMenu();
    const hours = screen.getAllByRole("listbox")[0];
    if (hours === undefined) throw new Error("沒有時選單");
    expect(
      within(hours).getByRole("option", { name: "7 hours" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(hours).getByRole("option", { name: "8 hours" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(
      within(hours).getByRole("option", { name: "19 hours" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it('size="small" 會把尺寸透傳給輸入格與標籤;不給時維持 medium', () => {
    const { container, unmount } = render(
      <TimePicker label="開始" value="09:00" size="small" />,
    );
    expect(
      container.querySelector(".MuiPickersInputBase-inputSizeSmall"),
    ).toBeInTheDocument();
    expect(container.querySelector(".MuiInputLabel-sizeSmall")).not.toBeNull();
    unmount();

    const medium = render(<TimePicker label="開始" value="09:00" />);
    expect(
      medium.container.querySelector(".MuiPickersInputBase-inputSizeSmall"),
    ).toBeNull();
  });

  it("error + helperText 會渲染成錯誤提示", () => {
    render(
      <TimePicker label="開始" value="09:00" error helperText="請選時間" />,
    );

    expect(screen.getByText("請選時間")).toBeInTheDocument();
  });

  it("hiddenLabel:不畫浮動標籤,label 改當欄位的名稱", () => {
    const { container } = render(
      <TimePicker label="開始" hiddenLabel value="09:00" />,
    );

    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByLabelText("開始")).toBe(field());
  });

  describe("鍵盤逐位輸入(受控往返)", () => {
    it("改小時:打完兩位才送出,分鐘不動", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(<Controlled initial="09:30" onChange={handleChange} />);

      await user.click(section("Hours"));
      await user.keyboard("1");
      expect(section("Hours").textContent).toBe("01");
      await user.keyboard("4");

      expect(section("Hours").textContent).toBe("14");
      expect(section("Minutes")).toHaveFocus();
      expect(handleChange).toHaveBeenLastCalledWith("14:30", DONE);
      expect(fieldText()).toContain("14:30");
    });

    it("清掉分鐘一段:送 null + isIncomplete(打到一半),小時留著;再打分鐘就送出完整時間", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(<Controlled initial="09:30" onChange={handleChange} />);

      await user.click(section("Minutes"));
      await user.keyboard("{Backspace}");

      // MUI 清掉單一區段時回 `null`(與全部清空同一個值),usePickerDraft 以選取中的區段分辨
      expect(handleChange).toHaveBeenLastCalledWith(null, {
        isIncomplete: true,
      });
      expect(section("Hours").textContent).toBe("09");
      expect(section("Minutes").textContent).toBe("mm");

      await user.keyboard("45");
      expect(handleChange).toHaveBeenLastCalledWith("09:45", DONE);
    });

    it("清空:全選刪除送出 null(不是打到一半)", async () => {
      const user = userEvent.setup();
      const handleChange =
        jest.fn<(value: string | null, details: PickerChangeDetails) => void>();
      render(<Controlled initial="09:30" onChange={handleChange} />);

      await user.click(section("Hours"));
      await user.keyboard("{Control>}a{/Control}{Backspace}");

      expect(handleChange).toHaveBeenLastCalledWith(null, DONE);
      expect(fieldText()).toContain("hh:mm");
    });

    it("外部換成別的值會覆蓋打到一半的草稿", async () => {
      const user = userEvent.setup();
      render(
        <Controlled initial="09:30" resetTo="18:15" onChange={jest.fn()} />,
      );

      await user.click(section("Minutes"));
      await user.keyboard("{Backspace}");
      await user.click(screen.getByRole("button", { name: "外部改值" }));

      expect(fieldText()).toContain("18:15");
    });
  });

  /** MUI X 的組字、全形數字、NBSP 問題由 `useFieldInputGuard` 攔截(與 DatePicker 同一份)。 */
  describe("輸入法組字、全形數字、空白", () => {
    it.each(["compositionend", "insertText"] as const)(
      "注音逐鍵組字打 1830(%s):每個數字只套用一次",
      async (commitWith) => {
        const user = userEvent.setup();
        const handleChange = jest.fn();
        render(<Controlled initial={null} onChange={handleChange} />);

        await user.click(section("Hours"));
        await composeEach("18", commitWith);
        expect(section("Hours").textContent).toBe("18");
        await composeEach("30", commitWith);

        expect(handleChange).toHaveBeenLastCalledWith("18:30", DONE);
      },
    );

    it("全形數字:一次確認整串、不經組字直接送出,都當半形數字", async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Controlled initial="09:30" onChange={handleChange} />);

      await user.click(section("Hours"));
      await compose("１８");
      typeRaw("４５");

      expect(handleChange).toHaveBeenLastCalledWith("18:45", DONE);
    });

    it("時與分之間打空白(Chromium 寫成 NBSP)不當成 0", async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Controlled initial={null} onChange={handleChange} />);

      await user.click(section("Hours"));
      typeRaw("18\u00A030");

      expect(handleChange).toHaveBeenLastCalledWith("18:30", DONE);
      expect(fieldText()).toContain("18:30");
    });
  });
});
