import { describe, expect, it } from "@jest/globals";

import {
  type ApplyTemplateLike,
  type ExistingDemandLike,
  planTemplateApply,
  weekdayOf,
} from "./template-apply";

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);
const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
const spanOf = (date: string, startTime: string, endTime: string) => ({
  startAt: at(date, startTime),
  endAt: at(endTime <= startTime ? nextDay(date) : date, endTime),
});

const template = (
  id: string,
  startTime: string,
  endTime: string,
  positionKey = "counter",
): ApplyTemplateLike => ({
  id,
  startTime,
  endTime,
  positionKey,
  tasks: [{ role: "leader", taskKey: "lead" }],
});

const existing = (
  date: string,
  start: string,
  end: string,
  positionKey = "counter",
): ExistingDemandLike => ({
  date,
  startAt: at(date, start),
  endAt: at(date, end),
  positionKey,
});

const MORNING = template("am", "08:30", "14:30");
const EVENING = template("pm", "14:30", "22:00");

describe("套用人力需求範本(規格 14.4)", () => {
  it("同一天時間和崗位都相同的略過(不論哪個範本);只是時間重疊的照常產生", () => {
    const plan = planTemplateApply({
      request: { kind: "template", templates: [MORNING, EVENING] },
      dates: ["2026-11-05", "2026-11-06"],
      existing: [
        // 手動建的同時段同崗位 → 略過
        existing("2026-11-05", "08:30", "14:30"),
        // 時間重疊但不相同 → 照常產生
        existing("2026-11-06", "09:00", "14:30"),
        // 時間相同、崗位不同 → 照常產生
        existing("2026-11-06", "14:30", "22:00", "outdoor"),
      ],
      closedDates: new Set(),
      spanOf,
    });
    expect(
      plan.created.map((item) => `${item.date} ${item.templateId}`),
    ).toEqual(["2026-11-05 pm", "2026-11-06 am", "2026-11-06 pm"]);
    expect(plan.skippedSlots).toBe(1);
  });

  it("兩個範本內容相同 → 同一天只產生一筆", () => {
    const plan = planTemplateApply({
      request: {
        kind: "template",
        templates: [MORNING, template("am-copy", "08:30", "14:30")],
      },
      dates: ["2026-11-05"],
      existing: [],
      closedDates: new Set(),
      spanOf,
    });
    expect(plan.created).toHaveLength(1);
    expect(plan.skippedSlots).toBe(1);
  });

  it("店休的日子不產生;跨午夜的範本結束在隔天;複製執行任務", () => {
    const plan = planTemplateApply({
      request: {
        kind: "template",
        templates: [template("night", "22:00", "06:00")],
      },
      dates: ["2026-11-03", "2026-11-04"],
      existing: [],
      closedDates: new Set(["2026-11-03"]),
      spanOf,
    });
    expect(plan.created).toHaveLength(1);
    expect(plan.created[0]?.endAt).toEqual(at("2026-11-05", "06:00"));
    expect(plan.created[0]?.tasks).toEqual([
      { role: "leader", taskKey: "lead" },
    ]);
  });
});

describe("套用人力需求週範本(規格 14.4)", () => {
  // 2026-11-01 是星期日
  const days = [[], [MORNING, EVENING], [MORNING], [], [], [], []];

  it("星期幾用那一格的範本;只補完全沒有人力需求的日子,已有任何人力需求的日子不動", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    const plan = planTemplateApply({
      request: { kind: "week-template", days },
      dates: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-09"],
      existing: [existing("2026-11-09", "18:00", "20:00", "outdoor")],
      closedDates: new Set(),
      spanOf,
    });
    expect(
      plan.created.map((item) => `${item.date} ${item.templateId}`),
    ).toEqual(["2026-11-02 am", "2026-11-02 pm", "2026-11-03 am"]);
    expect(plan.filledDays).toBe(2);
    expect(plan.skippedDays).toBe(1);
    expect(plan.skippedSlots).toBe(0);
  });
});
