import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ScheduleTimeline,
  type ScheduleTimelineProps,
} from "./ScheduleTimeline";
import {
  WEEK,
  at,
  bar,
  group,
  weekDates,
} from "./schedule-timeline-story-data";

/** 長條「較短」、選取(aria-pressed)、空白格的鍵盤停留點、週欄寬自動平分。 */

const [D1, , D3, D4] = WEEK;

const renderTimeline = (props: Partial<ScheduleTimelineProps> = {}) =>
  render(
    <ScheduleTimeline
      mode="week"
      dates={weekDates}
      groups={[]}
      today={D4}
      dayWidth={157}
      aria-label="時間軸"
      {...props}
    />,
  );

const cell = (date: string, time: string) =>
  screen.getByRole("button", { name: `+ ${date} ${time}` });
const inTabOrder = () =>
  screen
    .getAllByRole("button")
    .filter((button) => button.getAttribute("tabindex") === "0");
const columnWidth = () => {
  const column = document.querySelector<HTMLElement>(
    `[data-date="${CSS.escape(D4)}"]`,
  );
  if (column === null) throw new Error("沒有 11/4 這一欄");
  return getComputedStyle(column).width;
};

describe("長條狀態「較短」", () => {
  it("日模式:較短的長條只留標題,副標移到滑過提示;正常的長條照畫副標", async () => {
    const user = userEvent.setup();
    renderTimeline({
      mode: "day",
      dates: [{ date: D4 }],
      onBarClick: jest.fn(),
      groups: [
        group("g", D4, 8, 14, "早班", "早", [
          bar("n", D4, 8, 14, "王小明", { subtitle: "正常副標" }),
          bar("s", D4, 9, 12, "張小芳", {
            state: "short",
            subtitle: "較短副標",
            tooltip: "模組提示",
          }),
        ]),
      ],
    });

    const short = screen.getByRole("button", { name: "張小芳" });
    expect(short).toHaveAttribute("data-state", "short");
    expect(screen.getByText("正常副標")).toBeInTheDocument();
    expect(screen.queryByText("較短副標")).toBeNull();

    await user.hover(short);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("較短副標");
    expect(tooltip).toHaveTextContent("模組提示");
  });
});

describe("選取與鍵盤", () => {
  it("使用處沒給 selection:按鈕不標 aria-pressed", () => {
    renderTimeline({
      groups: [
        group("g", D4, 8, 12, "早班", "早", [bar("x", D4, 8, 12, "陳大文")]),
      ],
      onBarClick: jest.fn(),
      onGroupClick: jest.fn(),
    });

    expect(screen.getByRole("button", { name: "陳大文" })).not.toHaveAttribute(
      "aria-pressed",
    );
    expect(screen.getByRole("button", { name: /^早班/ })).not.toHaveAttribute(
      "aria-pressed",
    );
  });

  it("空白格只有一格在 tab 順序裡;方向鍵移動、跳過不能操作的日子,Enter 回呼", async () => {
    const user = userEvent.setup();
    const onEmptyClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onEmptyClick"]>>();
    renderTimeline({
      onEmptyClick,
      disabledRanges: [{ start: at(D3, 0), end: at(D3, 24) }],
    });

    // 預設停留點:第一天 08:00
    expect(inTabOrder()).toEqual([cell(D1, "08:00")]);

    await user.tab();
    expect(cell(D1, "08:00")).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowRight}");
    expect(cell("2026-11-02", "09:00")).toHaveFocus();
    // 11/3 整天不能操作 → 直接跳到 11/4
    await user.keyboard("{ArrowRight}");
    expect(cell(D4, "09:00")).toHaveFocus();
    expect(inTabOrder()).toEqual([cell(D4, "09:00")]);

    await user.keyboard("{Enter}");
    expect(onEmptyClick).toHaveBeenCalledWith(
      expect.objectContaining({ date: D4, time: "09:00" }),
    );
  });
});

describe("週欄寬自動平分", () => {
  let resize: ((width: number) => void) | null;
  beforeEach(() => {
    resize = null;
    class FakeResizeObserver {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe() {
        resize = (width) => {
          this.callback(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        };
      }
      disconnect() {
        resize = null;
      }
    }
    Object.assign(globalThis, { ResizeObserver: FakeResizeObserver });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("不給 dayWidth:欄寬 = floor((容器內容寬 − 48) / 7)", () => {
    renderTimeline({ dayWidth: undefined });

    act(() => {
      resize?.(1148);
    });
    expect(columnWidth()).toBe("157px");

    act(() => {
      resize?.(1000);
    });
    expect(columnWidth()).toBe(`${String(Math.floor((1000 - 48) / 7))}px`);
  });

  it("量不到寬度時退回 157", () => {
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    renderTimeline({ dayWidth: undefined });

    expect(columnWidth()).toBe("157px");
  });
});
