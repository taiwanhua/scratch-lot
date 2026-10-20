import { describe, expect, it } from "@jest/globals";

import {
  datesOfMonth,
  daySummaryOf,
  demandAreaRows,
  demandCountText,
  demandCountsOf,
  demandRemovalImpact,
  demandToneOf,
  entryChipOf,
  localPartsOf,
  spanOf,
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

  it("一個月的每一天", () => {
    expect(datesOfMonth("2026-02")).toHaveLength(28);
    expect(datesOfMonth("2026-11").at(-1)).toBe("2026-11-30");
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
