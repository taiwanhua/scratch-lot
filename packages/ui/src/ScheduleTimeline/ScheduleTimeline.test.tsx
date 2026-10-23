import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  vacancy,
  weekDates,
} from "./schedule-timeline-story-data";

const [D1, , D3, D4, D5] = WEEK;
const TODAY = D4;

const renderTimeline = (props: Partial<ScheduleTimelineProps> = {}) =>
  render(
    <ScheduleTimeline
      mode="week"
      dates={weekDates}
      groups={[]}
      today={TODAY}
      dayWidth={157}
      aria-label="時間軸"
      {...props}
    />,
  );

const dayColumn = (date: string) => {
  const column = document.querySelector<HTMLElement>(
    `[data-date="${CSS.escape(date)}"]`,
  );
  if (column === null) throw new Error(`沒有 ${date} 這一欄`);
  return column;
};

/** 自動捲動寫進捲動容器的位置(jsdom 不算版面,攔 setter 記下寫入值)。 */
let scrolled: { top: number[]; left: number[] };
beforeEach(() => {
  scrolled = { top: [], left: [] };
  jest
    .spyOn(Element.prototype, "scrollTop", "set")
    .mockImplementation((value: number) => {
      scrolled.top.push(value);
    });
  jest
    .spyOn(Element.prototype, "scrollLeft", "set")
    .mockImplementation((value: number) => {
      scrolled.left.push(value);
    });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("進入畫面自動捲動", () => {
  it("週模式:捲到最早的長條前 1 小時(每小時 36px)", () => {
    renderTimeline({
      groups: [
        group("a", D4, 10, 14, "上午場", "早", [bar("a1", D4, 9.5, 14, "甲")]),
        group("b", D5, 12, 18, "午場", "午", [bar("b1", D5, 12, 18, "乙")]),
      ],
    });

    // 09:30 的長條(延伸出容器)最早 → 08:30
    expect(scrolled.top).toEqual([8.5 * 36]);
  });

  it("容器比長條早開始時以容器為準;日模式橫向捲(每小時 64px)", () => {
    renderTimeline({
      mode: "day",
      dates: [{ date: D4 }],
      groups: [
        group("a", D4, 7, 14, "上午場", "早", [bar("a1", D4, 9, 14, "甲")]),
      ],
    });

    expect(scrolled.left).toEqual([6 * 64]);
    expect(scrolled.top).toEqual([]);
  });

  it("沒有資料:捲到 08:00", () => {
    renderTimeline();

    expect(scrolled.top).toEqual([8 * 36]);
  });

  it("切換週會重新捲;同一週資料變動不搶捲動位置;先沒資料、資料到了再捲一次", () => {
    const early = [
      group("a", D4, 10, 14, "上午場", "早", [bar("a1", D4, 10, 14, "甲")]),
    ];
    const { rerender } = renderTimeline();
    const view = (props: Partial<ScheduleTimelineProps>) => (
      <ScheduleTimeline
        mode="week"
        dates={weekDates}
        groups={[]}
        today={TODAY}
        dayWidth={157}
        {...props}
      />
    );

    rerender(view({ groups: early }));
    rerender(
      view({
        groups: [
          ...early,
          group("b", D4, 6, 9, "加開場", "加", [bar("b1", D4, 6, 9, "乙")]),
        ],
      }),
    );
    rerender(
      view({
        dates: weekDates.map((d) => ({ date: d.date.replace("11-0", "11-1") })),
      }),
    );

    // 沒資料 08:00 → 資料到了捲到 09:00 → 同週加一筆更早的不動 → 換週(沒資料)08:00
    expect(scrolled.top).toEqual([8 * 36, 9 * 36, 8 * 36]);
  });

  it("週模式收進「+N」的容器不算(只算畫得出來的)", () => {
    const tooWide = group(
      "wide",
      D4,
      6,
      12,
      "會議",
      "會",
      ["1", "2", "3", "4", "5"].map((n) => bar(`w${n}`, D4, 6, 12, n)),
    );
    renderTimeline({
      groups: [
        tooWide,
        group("a", D4, 9, 14, "上午場", "早", [bar("a1", D4, 9, 14, "甲")]),
      ],
    });

    // 5 條要 160 寬 > 157 → 整筆收起;只剩 09:00 的上午場 → 08:00
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(scrolled.top).toEqual([8 * 36]);
  });
});

describe("跨午夜", () => {
  const night = group("n", D4, 20, 26, "夜間場 · 場地 C", "夜", [
    bar("n1", D4, 20, 26, "陳大文"),
  ]);

  it("週模式:當天畫到 24:00 標「→ 次日」,次日從 00:00 接續標「前日 →」", () => {
    renderTimeline({ groups: [night] });

    const today = within(dayColumn(D4));
    const next = within(dayColumn(D5));
    expect(today.getByText("→ 次日")).toBeInTheDocument();
    expect(today.queryByText("前日 →")).toBeNull();
    expect(next.getByText("前日 →")).toBeInTheDocument();
    expect(next.queryByText("→ 次日")).toBeNull();
    expect(today.getAllByText("陳大文")).toHaveLength(1);
    expect(next.getAllByText("陳大文")).toHaveLength(1);
  });

  it("日模式顯示次日:容器標題也標「前日 →」", () => {
    renderTimeline({ mode: "day", dates: [{ date: D5 }], groups: [night] });

    expect(screen.getByText(/前日 → *夜間場 · 場地 C/)).toBeInTheDocument();
  });
});

describe("回呼帶出的日期與時間", () => {
  const shift = bar("s1", D4, 8.5, 14.5, "王小明");
  const missing = vacancy("s2", "協同");
  const early = group("early", D4, 8.5, 14.5, "上午場", "早", [shift, missing]);
  const night = group("night", D4, 20, 26, "夜間場", "夜", [
    bar("n1", D4, 20, 26, "陳大文"),
  ]);

  it("長條:鍵盤取該段開始所在的那一小時;次日接續段帶次日 00:00", async () => {
    const user = userEvent.setup();
    const onBarClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onBarClick"]>>();
    renderTimeline({ groups: [early, night], onBarClick });

    act(() => {
      screen.getByRole("button", { name: "王小明" }).focus();
    });
    await user.keyboard("{Enter}");
    await user.click(
      within(dayColumn(D5)).getByRole("button", { name: "陳大文" }),
    );

    expect(onBarClick).toHaveBeenCalledTimes(2);
    const [first, second] = onBarClick.mock.calls;
    expect(first?.[0]).toBe(shift);
    expect(first?.[1]).toBe(early);
    expect(first?.[2]).toEqual({
      date: D4,
      time: "08:00",
      at: new Date(at(D4, 8)),
    });
    expect(second?.[2]).toMatchObject({ date: D5, time: "00:00" });
    expect(second?.[2].at.getTime()).toBe(at(D5, 0));
  });

  it("滑鼠點到長條中段:帶出點到的那一小時(從當天欄頂端量起)", () => {
    const onBarClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onBarClick"]>>();
    renderTimeline({ groups: [early], onBarClick });
    jest
      .spyOn(dayColumn(D4), "getBoundingClientRect")
      .mockReturnValue({ top: 100, left: 0 } as DOMRect);

    fireEvent.click(screen.getByRole("button", { name: "王小明" }), {
      clientY: 100 + 10.5 * 36,
    });

    expect(onBarClick.mock.calls[0]?.[2]).toMatchObject({
      date: D4,
      time: "10:00",
    });
  });

  it("缺額空位另帶群組與空位;容器(空白鍵)帶容器開始的那一小時", async () => {
    const user = userEvent.setup();
    const onVacancyClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onVacancyClick"]>>();
    const onGroupClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onGroupClick"]>>();
    renderTimeline({ groups: [early], onVacancyClick, onGroupClick });

    await user.click(screen.getByRole("button", { name: "缺協同 1" }));
    act(() => {
      screen.getByRole("button", { name: /^上午場/ }).focus();
    });
    await user.keyboard(" ");

    expect(onVacancyClick).toHaveBeenCalledWith(
      missing,
      early,
      expect.objectContaining({ date: D4, time: "08:00" }),
    );
    expect(onGroupClick).toHaveBeenCalledWith(
      early,
      expect.objectContaining({ date: D4, time: "08:00" }),
    );
  });

  it("空白處:每小時一格,帶那一格的日期與時間;不能操作的時間沒有格子可點", async () => {
    const user = userEvent.setup();
    const onEmptyClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onEmptyClick"]>>();
    renderTimeline({
      onEmptyClick,
      emptyHint: "+ 時段需求",
      disabledRanges: [{ start: at(D3, 0), end: at(D3, 24), label: "公休" }],
    });

    await user.click(
      screen.getByRole("button", { name: "+ 時段需求 2026-11-04 15:00" }),
    );

    expect(onEmptyClick).toHaveBeenCalledWith({
      date: D4,
      time: "15:00",
      at: new Date(at(D4, 15)),
    });
    expect(within(dayColumn(D3)).queryAllByRole("button")).toEqual([]);
    expect(within(dayColumn(D3)).getByText("公休")).toBeInTheDocument();
    expect(within(dayColumn(D4)).getAllByRole("button")).toHaveLength(24);
  });

  it("停用的長條不可點;沒給回呼時不是按鈕", () => {
    const onBarClick = jest.fn();
    renderTimeline({
      groups: [
        group("g", D4, 8, 12, "上午場", "早", [
          bar("x", D4, 8, 12, "陳大文", { state: "disabled" }),
        ]),
      ],
      onBarClick,
    });

    expect(screen.queryByRole("button", { name: "陳大文" })).toBeNull();
    fireEvent.click(screen.getByText("陳大文"));
    expect(onBarClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^上午場/ })).toBeNull();
  });

  it("週模式放不下的收進「+N」:點了帶日期與被收起的容器;已選取的標 aria-pressed", async () => {
    const user = userEvent.setup();
    const onMoreClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onMoreClick"]>>();
    const wide = (id: string) =>
      group(id, D1, 9, 12, id, id, [
        bar(`${id}-1`, D1, 9, 12, `${id}甲`),
        bar(`${id}-2`, D1, 9, 12, `${id}乙`),
        bar(`${id}-3`, D1, 9, 12, `${id}丙`),
      ]);
    const groups = [wide("A"), wide("B")];
    renderTimeline({
      groups,
      onMoreClick,
      onBarClick: jest.fn(),
      selection: { kind: "bar", id: "A-1" },
    });

    await user.click(screen.getByRole("button", { name: "2026-11-01 +1" }));

    expect(onMoreClick).toHaveBeenCalledWith(D1, groups.slice(1));
    expect(screen.getByRole("button", { name: "A甲" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "A乙" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryByText("B甲")).toBeNull();
  });
});

const todayHeaders = () =>
  [...document.querySelectorAll("[data-timeline-header]")].filter(
    (cell) => cell.getAttribute("aria-current") === "date",
  );

describe("今天(日期表頭主色實心圓)", () => {
  it("週模式:只有今天那一欄的表頭有今天樣式", () => {
    renderTimeline();

    const headers = todayHeaders();
    expect(headers).toHaveLength(1);
    expect(headers[0]).toHaveTextContent("11/4");
    expect(headers[0]?.querySelector("[data-today]")).toHaveTextContent("11/4");
  });

  it("週模式顯示的不是今天所在的週:沒有今天樣式", () => {
    renderTimeline({ today: "2026-12-25" });

    expect(todayHeaders()).toEqual([]);
    expect(document.querySelector("[data-today]")).toBeNull();
  });

  it("日模式顯示的是今天:表頭有今天樣式;不是今天時沒有", () => {
    const { unmount } = renderTimeline({ mode: "day", dates: [{ date: D4 }] });
    expect(todayHeaders()).toHaveLength(1);
    unmount();

    renderTimeline({ mode: "day", dates: [{ date: D5 }] });
    expect(todayHeaders()).toEqual([]);
  });
});

describe("時區(timezone)", () => {
  // 11/4 10:00–14:00 東京時間(UTC+9)= 01:00–05:00 UTC
  const start = Date.UTC(2026, 10, 4, 1);
  const end = Date.UTC(2026, 10, 4, 5);
  // 沒給 ariaLabel:名稱退回時間範圍(以時區顯示)
  const unlabeled = {
    ...bar("t1", D4, 0, 1, "甲"),
    start,
    end,
    ariaLabel: undefined,
  };
  const tokyo = group("t", D4, 0, 1, "東京場", "東", [unlabeled], {
    start,
    end,
  });

  it("位置、預設名稱與回呼時點都用時區當地的時間", async () => {
    const user = userEvent.setup();
    const onBarClick =
      jest.fn<NonNullable<ScheduleTimelineProps["onBarClick"]>>();
    renderTimeline({
      groups: [tokyo],
      timezone: "Asia/Tokyo",
      onBarClick,
    });

    // 東京 10:00 開始 → 捲到 09:00
    expect(scrolled.top).toEqual([9 * 36]);
    act(() => {
      screen.getByRole("button", { name: "10:00–14:00" }).focus();
    });
    await user.keyboard("{Enter}");

    expect(onBarClick.mock.calls[0]?.[2]).toEqual({
      date: D4,
      time: "10:00",
      at: new Date(start),
    });
  });

  it("沒給 today 時,今天依時區的此刻(UTC 11/4 16:00 = 東京 11/5)", () => {
    jest.useFakeTimers({ now: Date.UTC(2026, 10, 4, 16) });
    try {
      render(
        <ScheduleTimeline
          mode="week"
          dates={weekDates}
          groups={[]}
          timezone="Asia/Tokyo"
          dayWidth={157}
        />,
      );

      expect(todayHeaders()).toHaveLength(1);
      expect(todayHeaders()[0]).toHaveTextContent("11/5");
    } finally {
      jest.useRealTimers();
    }
  });
});
