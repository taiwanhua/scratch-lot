import { describe, expect, it } from "@jest/globals";

import { formatTemporal } from "@repo/domain/form";

import {
  datesOfMonth,
  dayInstantOf,
  dayRangeOf,
  daySummaryOf,
  demandAreaRows,
  demandCountText,
  demandCountsOf,
  demandRemovalImpact,
  demandToneOf,
  entryChipOf,
  lastDayShownAt,
  localPartsOf,
  monthDayOf,
  shiftDay,
  shiftMonthOf,
  spanOf,
  weekdayOf,
} from "./schedule-roster";

const TZ = "Asia/Taipei";
const LABELS = { leader: "負", helper: "協" };
const iso = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const demand = (
  id: string,
  date: string,
  start: string,
  end: string,
  tasks: { role: string; entryId: string | null }[],
  templateId: string | null = null,
) => ({
  id,
  date,
  startAt: iso(date, start),
  endAt: iso(date, end),
  positionKey: "in-store-counter",
  templateId,
  tasks: tasks.map((task, index) => ({
    taskId: `${id}-${String(index)}`,
    ...task,
  })),
});

describe("排班表的時間換算(租戶時區)", () => {
  it("開始 / 結束 → 時點;結束不晚於開始 = 跨午夜", () => {
    expect(spanOf("2026-11-04", "14:30", "22:00", TZ)).toEqual({
      startAt: iso("2026-11-04", "14:30"),
      endAt: iso("2026-11-04", "22:00"),
    });
    expect(spanOf("2026-11-04", "22:00", "06:00", TZ)).toEqual({
      startAt: iso("2026-11-04", "22:00"),
      endAt: iso("2026-11-05", "06:00"),
    });
    expect(spanOf("2026-11-04", "", "06:00", TZ)).toBeNull();
    expect(localPartsOf(iso("2026-11-04", "08:30"), TZ)).toEqual({
      date: "2026-11-04",
      time: "08:30",
    });
  });

  it("結束 00:00 = 隔天 00:00(做到當天結束)", () => {
    expect(spanOf("2026-11-04", "18:00", "00:00", TZ)).toEqual({
      startAt: iso("2026-11-04", "18:00"),
      endAt: iso("2026-11-05", "00:00"),
    });
  });

  it("租戶時區不是台北:日期鍵 → 那天洛杉磯 00:00;期間是半開區間;夏令時間結束那天 25 小時", () => {
    const LA = "America/Los_Angeles";
    expect(dayInstantOf("2026-11-04", LA)).toBe("2026-11-04T08:00:00.000Z");
    // 11/1 夏令時間結束:11/1 00:00 是 UTC−7,11/2 00:00 是 UTC−8
    expect(dayRangeOf("2026-11-01", "2026-11-01", LA)).toEqual({
      from: "2026-11-01T07:00:00.000Z",
      to: "2026-11-02T08:00:00.000Z",
    });
    expect(spanOf("2026-11-04", "22:00", "06:00", LA)).toEqual({
      startAt: "2026-11-05T06:00:00.000Z",
      endAt: "2026-11-05T14:00:00.000Z",
    });
    expect(monthDayOf("2026-11-04", LA)).toBe("11/4");
    expect(monthDayOf("", LA)).toBe("");
    // 半開區間的迄 → 顯示的迄日是前一天(夏令時間結束那天也一樣)
    const range = dayRangeOf("2026-10-30", "2026-11-01", LA);
    expect(
      formatTemporal(lastDayShownAt(range?.to) ?? "", {
        type: "monthDay",
        timezone: LA,
      }),
    ).toBe("11/1");
    expect(lastDayShownAt(null)).toBeNull();
  });

  it("一個月的每一天、加減天 / 月、星期幾(日曆運算用 @repo/domain/form)", () => {
    expect(datesOfMonth("2026-02")).toHaveLength(28);
    expect(datesOfMonth("2028-02")).toHaveLength(29);
    expect(datesOfMonth("2026-11").at(-1)).toBe("2026-11-30");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonthOf("2026-01", -1)).toBe("2025-12");
    expect(weekdayOf("2026-11-01")).toBe(0);
  });
});

describe("人數寫法與三態(規格 14.5)", () => {
  it.each([
    [
      [
        { role: "leader", entryId: "e1" },
        { role: "helper", entryId: null },
      ],
      "負1/1 協0/1",
      "warning",
    ],
    [[{ role: "helper", entryId: "e1" }], "協1/1", "grey"],
    [
      [
        { role: "leader", entryId: null },
        { role: "helper", entryId: "e2" },
      ],
      "負0/1 協1/1",
      "error",
    ],
    [[{ role: "leader", entryId: "e1" }], "負1/1", "grey"],
  ])("%j → %s(%s)", (tasks, text, tone) => {
    const counts = demandCountsOf(
      tasks.map((task, index) => ({ taskId: String(index), ...task })),
    );
    expect(demandCountText(counts, LABELS)).toBe(text);
    expect(demandToneOf(counts)).toBe(tone);
  });

  it("收合時的每日彙總:需 / 已排 / 缺 / 可排,顏色取最嚴重的", () => {
    const summary = daySummaryOf(
      [
        demand("d1", "2026-11-02", "08:30", "14:30", [
          { role: "leader", entryId: "e1" },
          { role: "helper", entryId: "e2" },
        ]),
        demand("d2", "2026-11-02", "14:30", "22:00", [
          { role: "leader", entryId: "e3" },
          { role: "helper", entryId: null },
          { role: "helper", entryId: "e4" },
        ]),
      ],
      2,
    );
    expect(summary).toEqual({
      need: 5,
      filled: 4,
      missing: 1,
      available: 2,
      tone: "warning",
    });
    expect(daySummaryOf([], 3)).toBeNull();
  });
});

describe("人力需求區的列", () => {
  it("每種範本一列(沒有人力需求的也列),未套用範本或看不到的範本歸「臨」", () => {
    const rows = demandAreaRows(
      ["t-early", "t-late"],
      [
        demand("d1", "2026-11-02", "08:30", "14:30", [], "t-early"),
        demand("d2", "2026-11-02", "13:00", "17:00", [], null),
        demand("d3", "2026-11-03", "13:00", "17:00", [], "t-gone"),
      ],
    );
    expect(rows.map((row) => row.templateId)).toEqual([
      "t-early",
      "t-late",
      null,
    ]);
    expect(rows[0]?.byDate.get("2026-11-02")?.map((item) => item.id)).toEqual([
      "d1",
    ]);
    expect(rows[1]?.byDate.size).toBe(0);
    expect([...(rows[2]?.byDate.keys() ?? [])]).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
  });
});

const SHORT_NAMES: Record<string, string> = { "t-late": "晚", "t-early": "早" };
const short = (id: string | null | undefined) =>
  id === null || id === undefined ? null : (SHORT_NAMES[id] ?? null);
const entry = (
  assignments: { demandId: string; role: string; source: string }[],
) => ({
  id: "e",
  userId: "u",
  date: "2026-11-05",
  startAt: iso("2026-11-05", "08:30"),
  endAt: iso("2026-11-05", "22:00"),
  breakMinutes: 30,
  assignments,
});

describe("班表格子上的一筆排班", () => {
  const evening = demand("a", "2026-11-05", "14:30", "22:00", [], "t-late");
  const eveningB = demand("b", "2026-11-05", "14:30", "22:00", [], "t-late");
  const early = demand("c", "2026-11-05", "08:30", "14:30", [], "t-early");
  const temp = demand("d", "2026-11-05", "13:00", "17:00", [], null);
  const byId = new Map(
    [evening, eveningB, early, temp].map((item) => [item.id, item]),
  );
  it("同一段時間填進兩筆 →「晚 ×2」;負責 → 負責人底色", () => {
    expect(
      entryChipOf(
        entry([
          { demandId: "a", role: "leader", source: "manual" },
          { demandId: "b", role: "leader", source: "manual" },
        ]),
        byId,
        short,
      ),
    ).toEqual({
      shortNames: ["晚"],
      multiCount: 2,
      isLead: true,
      isAuto: false,
    });
  });

  it("跨好幾段(不重疊)→「早 + 晚」;未套用範本 → null(臨);自動排入", () => {
    expect(
      entryChipOf(
        entry([
          { demandId: "c", role: "helper", source: "auto" },
          { demandId: "a", role: "helper", source: "manual" },
        ]),
        byId,
        short,
      ),
    ).toEqual({
      shortNames: ["早", "晚"],
      multiCount: 1,
      isLead: false,
      isAuto: true,
    });
    expect(
      entryChipOf(
        entry([{ demandId: "d", role: "helper", source: "manual" }]),
        byId,
        short,
      ).shortNames,
    ).toEqual([null]);
  });
});

describe("刪除人力需求 / 移除有人填的任務的影響", () => {
  const tasks = [
    {
      taskId: "l",
      role: "leader",
      taskKey: "lead",
      entryId: "e1",
      userName: "李小華",
    },
    {
      taskId: "h1",
      role: "helper",
      taskKey: "duty",
      entryId: "e2",
      userName: "王小明",
    },
    { taskId: "h2", role: "helper", taskKey: "duty", entryId: null },
  ];
  const entries = [
    // 李只填這一筆 → 一起刪
    {
      id: "e1",
      deletable: true,
      assignments: [{ demandId: "d", taskId: "l" }],
    },
    // 王還填了別筆 → 只解除
    {
      id: "e2",
      deletable: true,
      assignments: [
        { demandId: "d", taskId: "h1" },
        { demandId: "other", taskId: "x" },
      ],
    },
  ];

  it("整筆刪除:列出會解除的人;零筆的排班一起刪", () => {
    const impact = demandRemovalImpact("d", tasks, entries);
    expect(impact.released.map((task) => task.userName)).toEqual([
      "李小華",
      "王小明",
    ]);
    expect(impact.deleted.map((entry) => entry.id)).toEqual(["e1"]);
    expect(impact.blocked).toEqual([]);
  });

  it("被收銀班次綁定的排班列在 blocked;沒人填的任務不影響", () => {
    const impact = demandRemovalImpact(
      "d",
      tasks.filter((task) => task.taskId !== "h1"),
      entries.map((entry) =>
        entry.id === "e1" ? { ...entry, deletable: false } : entry,
      ),
    );
    expect(impact.released.map((task) => task.taskId)).toEqual(["l"]);
    expect(impact.deleted).toEqual([]);
    expect(impact.blocked.map((entry) => entry.id)).toEqual(["e1"]);
  });
});
