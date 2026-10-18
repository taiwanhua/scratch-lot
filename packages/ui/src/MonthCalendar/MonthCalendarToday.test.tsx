import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppThemeProvider } from "../AppThemeProvider/AppThemeProvider";
import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { defaultBrand } from "../theme/brands/default";
import { MonthCalendar, type MonthCalendarProps } from "./MonthCalendar";

/** 2026-10-17 新增的四列:[今天] 按鈕與已選日期的樣式。 */

const TODAY = "2026-10-16";

const renderCalendar = (props: Partial<MonthCalendarProps> = {}) => {
  const onMonthChange = jest.fn<(month: string) => void>();
  render(
    <AppThemeProvider brand={defaultBrand}>
      <MonthCalendar
        month="2026-10"
        today={TODAY}
        onMonthChange={onMonthChange}
        {...props}
      />
    </AppThemeProvider>,
  );
  return { onMonthChange };
};

const todayButton = () => screen.queryByRole("button", { name: "今天" });

describe("MonthCalendar [今天] 按鈕", () => {
  it("showTodayButton 開,顯示的不是當月,點 [今天]:呼叫 onMonthChange(今天所在的月份)", async () => {
    const { onMonthChange } = renderCalendar({
      month: "2027-02",
      showTodayButton: true,
    });

    const button = todayButton();
    expect(button).toBeEnabled();
    if (button === null) throw new Error("沒有 [今天]");
    await userEvent.click(button);

    expect(onMonthChange).toHaveBeenCalledWith("2026-10");
  });

  it("[今天] 和 ◀ ▶ 同一種外觀:灰框、一般文字色,不是主色", () => {
    renderCalendar({ month: "2027-02", showTodayButton: true });

    const button = todayButton();
    if (button === null) throw new Error("沒有 [今天]");
    expect(button).toHaveClass("MuiButton-outlined", "MuiButton-colorInherit");
    expect(button).not.toHaveClass("MuiButton-colorPrimary");
    // 只看按鈕本身的規則(不含 :hover、子元素等延伸選擇器)
    const own = `.${emotionClassOf(button)}`;
    const rules = cssRulesMatching(own).filter(
      (rule) => rule.selectorText === own,
    );
    expect(declaredValue(rules, "border-color")).toContain("divider");
    expect(declaredValue(rules, "color")).toContain("text-primary");
  });

  it("showTodayButton 開,顯示的已是當月:[今天] 停用", () => {
    renderCalendar({ showTodayButton: true });

    expect(todayButton()).toBeDisabled();
  });

  it("showTodayButton 關(預設):不顯示 [今天]", () => {
    renderCalendar();

    expect(todayButton()).toBeNull();
  });

  it("showHeader 關時,showTodayButton 開也不顯示", () => {
    renderCalendar({ showHeader: false, showTodayButton: true });

    expect(todayButton()).toBeNull();
  });
});

describe("MonthCalendar 已選日期", () => {
  it("single:選定的日子疊 primary.main × selectedOpacity + 1px primary.main 框", () => {
    renderCalendar({
      selectionMode: "single",
      selectedDates: ["2026-10-05"],
    });

    const cell = screen.getByRole("gridcell", { name: "2026-10-05" });
    const rules = cssRulesMatching(`.${emotionClassOf(cell)}`);
    const layer = declaredValue(rules, "background-image") ?? "";
    expect(layer).toContain("primary-main");
    expect(layer).toContain("selectedOpacity");
    expect(declaredValue(rules, "box-shadow")).toMatch(
      /^inset 0 0 0 1px .*primary-main/,
    );

    const other = screen.getByRole("gridcell", { name: "2026-10-06" });
    expect(
      declaredValue(
        cssRulesMatching(`.${emotionClassOf(other)}`),
        "box-shadow",
      ),
    ).toBe("none");
  });
});
