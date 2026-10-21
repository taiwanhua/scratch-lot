import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MonthCalendar, type MonthCalendarProps } from "./MonthCalendar";

/** 2026-10:10/1 是星期四;第 1 週 9/27–10/3、第 2 週 10/4–10/10 … 第 5 週 10/25–10/31。 */
const MONTH = "2026-10";

const renderCalendar = (props: Partial<MonthCalendarProps> = {}) => {
  const onSelectedDatesChange = jest.fn<(dates: string[]) => void>();
  const onMonthChange = jest.fn<(month: string) => void>();
  const view = render(
    <MonthCalendar
      month={MONTH}
      today="2026-10-16"
      onMonthChange={onMonthChange}
      onSelectedDatesChange={onSelectedDatesChange}
      {...props}
    />,
  );
  return { ...view, onSelectedDatesChange, onMonthChange };
};

const day = (date: string) => screen.getByRole("gridcell", { name: date });
const weekBox = (n: number) =>
  screen.getByRole("checkbox", { name: `選取第 ${String(n)} 週` });

describe("MonthCalendar 換月表頭", () => {
  it("showHeader 開:按 ◀ / ▶ 回報上 / 下個月,月份由外部傳入才換", async () => {
    const { onMonthChange, rerender } = renderCalendar();

    await userEvent.click(screen.getByRole("button", { name: "上一個月" }));
    await userEvent.click(screen.getByRole("button", { name: "下一個月" }));

    expect(onMonthChange.mock.calls).toEqual([["2026-09"], ["2026-11"]]);
    expect(screen.getByText("2026 年 10 月")).toBeInTheDocument();

    rerender(<MonthCalendar month="2026-11" />);
    expect(screen.getByText("2026 年 11 月")).toBeInTheDocument();
  });

  it("showHeader 關:不顯示表頭", () => {
    renderCalendar({ showHeader: false });

    expect(screen.queryByRole("button", { name: "上一個月" })).toBeNull();
    expect(screen.queryByText("2026 年 10 月")).toBeNull();
  });

  it("星期列從星期日開始", () => {
    renderCalendar();

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
  });
});

describe("MonthCalendar 選取模式", () => {
  it("none:點日期不選取,也沒有整週勾選框", async () => {
    const { onSelectedDatesChange } = renderCalendar();

    await userEvent.click(day("2026-10-05"));

    expect(onSelectedDatesChange).not.toHaveBeenCalled();
    expect(day("2026-10-05")).not.toHaveAttribute("aria-selected");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("single:點日期選定那一天;再點另一天就換成另一天", async () => {
    const { onSelectedDatesChange, rerender } = renderCalendar({
      selectionMode: "single",
    });

    await userEvent.click(day("2026-10-05"));
    expect(onSelectedDatesChange).toHaveBeenLastCalledWith(["2026-10-05"]);

    rerender(
      <MonthCalendar
        month={MONTH}
        selectionMode="single"
        selectedDates={["2026-10-05"]}
        onSelectedDatesChange={onSelectedDatesChange}
      />,
    );
    expect(day("2026-10-05")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);

    await userEvent.click(day("2026-10-06"));
    expect(onSelectedDatesChange).toHaveBeenLastCalledWith(["2026-10-06"]);
  });

  it("multiple:點日期切換那一天的選取(鍵盤 Enter 也可以)", async () => {
    const { onSelectedDatesChange } = renderCalendar({
      selectionMode: "multiple",
      selectedDates: ["2026-10-05"],
    });

    await userEvent.click(day("2026-10-05"));
    expect(onSelectedDatesChange).toHaveBeenLastCalledWith([]);

    day("2026-10-06").focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelectedDatesChange).toHaveBeenLastCalledWith([
      "2026-10-05",
      "2026-10-06",
    ]);
  });
});

describe("MonthCalendar 整週勾選框", () => {
  it("該週可選的日子沒有全選:全部選取,跳過停用日", async () => {
    const { onSelectedDatesChange } = renderCalendar({
      selectionMode: "multiple",
      days: { "2026-10-06": { disabled: true } },
    });

    await userEvent.click(weekBox(2));

    expect(onSelectedDatesChange).toHaveBeenLastCalledWith([
      "2026-10-04",
      "2026-10-05",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
  });

  it("該週可選的日子都已選:全部取消", async () => {
    const { onSelectedDatesChange } = renderCalendar({
      selectionMode: "multiple",
      // 第 1 週只有 10/1–10/3 是本月;10/2 停用
      days: { "2026-10-02": { disabled: true } },
      selectedDates: ["2026-10-01", "2026-10-03", "2026-10-20"],
    });

    expect(weekBox(1)).toBeChecked();
    await userEvent.click(weekBox(1));

    expect(onSelectedDatesChange).toHaveBeenLastCalledWith(["2026-10-20"]);
  });

  it("該週有些可選的日子已選:勾選框顯示半選", () => {
    renderCalendar({
      selectionMode: "multiple",
      selectedDates: ["2026-10-05"],
    });

    expect(weekBox(2)).toHaveAttribute("data-indeterminate", "true");
    expect(weekBox(2)).not.toBeChecked();
    expect(weekBox(3)).toHaveAttribute("data-indeterminate", "false");
  });

  it("該週全部停用:勾選框停用", () => {
    renderCalendar({
      selectionMode: "multiple",
      days: {
        "2026-10-01": { disabled: true },
        "2026-10-02": { disabled: true },
        "2026-10-03": { disabled: true },
      },
    });

    expect(weekBox(1)).toBeDisabled();
    expect(weekBox(2)).toBeEnabled();
  });
});

describe("MonthCalendar 不能選的日子", () => {
  it("點停用日沒有反應;滑過顯示原因", async () => {
    const { onSelectedDatesChange } = renderCalendar({
      selectionMode: "multiple",
      days: { "2026-10-06": { disabled: true, disabledReason: "公休" } },
    });
    const cell = day("2026-10-06");

    fireEvent.click(cell);
    expect(onSelectedDatesChange).not.toHaveBeenCalled();
    expect(cell).toHaveAttribute("aria-disabled", "true");
    expect(cell).not.toHaveAttribute("tabindex");

    await userEvent.hover(cell);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("公休");
  });

  it("點上 / 下個月的日期:只顯示,不能選", async () => {
    const { onSelectedDatesChange } = renderCalendar({
      selectionMode: "multiple",
    });

    await userEvent.click(day("2026-09-30"));

    expect(onSelectedDatesChange).not.toHaveBeenCalled();
    expect(day("2026-09-30")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("MonthCalendar 註記、角標與自訂內容", () => {
  it("顯示外部傳入的註記、小圓點、error badge 與自訂內容", () => {
    renderCalendar({
      days: {
        "2026-10-11": { note: "特殊日" },
        "2026-10-05": {
          corner: { variant: "dot", color: "warning", label: "有異動" },
        },
        "2026-10-12": {
          corner: { variant: "badge", content: "資料待補" },
          content: <span>09:00–17:00</span>,
        },
      },
    });

    expect(within(day("2026-10-11")).getByText("特殊日")).toBeInTheDocument();
    expect(
      within(day("2026-10-05")).getByRole("img", { name: "有異動" }),
    ).toBeInTheDocument();
    const badgeCell = day("2026-10-12");
    expect(within(badgeCell).getByText("資料待補")).toBeInTheDocument();
    expect(within(badgeCell).getByText("09:00–17:00")).toBeInTheDocument();
  });

  it("底色語意:特殊日 / 休息日標在格子上;前後補的日子不套", () => {
    renderCalendar({
      days: {
        "2026-10-11": { tone: "special", note: "店慶" },
        "2026-10-12": { tone: "closed" },
        "2026-09-30": { tone: "special" },
        "2026-10-13": { tone: "special", disabled: true },
      },
    });

    expect(day("2026-10-11")).toHaveAttribute("data-tone", "special");
    expect(day("2026-10-12")).toHaveAttribute("data-tone", "closed");
    expect(day("2026-09-30")).not.toHaveAttribute("data-tone");
    expect(day("2026-10-14")).not.toHaveAttribute("data-tone");
    // 停用優先:仍標語意,但底色是停用色
    expect(day("2026-10-13")).toHaveAttribute("aria-disabled", "true");
  });

  it("前後補的日子不畫註記與角標", () => {
    renderCalendar({
      days: {
        "2026-09-30": {
          note: "上月註記",
          corner: { variant: "dot", color: "error", label: "缺卡" },
        },
      },
    });

    expect(screen.queryByText("上月註記")).toBeNull();
    expect(screen.queryByRole("img", { name: "缺卡" })).toBeNull();
  });
});
