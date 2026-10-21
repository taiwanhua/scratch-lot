import { describe, expect, it } from "@jest/globals";

import {
  type FilledTask,
  closestEntryAt,
  taskSnapshotOf,
} from "./entry-matching";

const at = (time: string) => new Date(`2026-11-05T${time}:00+08:00`);

const entry = (id: string, start: string, end: string) => ({
  id,
  startAt: at(start),
  endAt: at(end),
});

describe("排班查詢:某人在某店某時間的排班(規格 14.9)", () => {
  const morning = entry("morning", "08:30", "14:30");
  const noon = entry("noon", "10:00", "16:00");
  const evening = entry("evening", "17:00", "22:00");

  it.each([
    ["容許 60 分鐘內兩筆 → 取上班時點最接近的", "09:20", 60, "noon"],
    ["上班前 60 分鐘內 → 對到", "07:30", 60, "morning"],
    ["上班前超過 60 分鐘 → null", "07:29", 60, null],
    ["班中間開班 → 對到那一班", "15:30", 60, "noon"],
    ["兩班都超過容許 → null", "16:30", 0, null],
    ["容許改成 30 分鐘:16:40 對到晚班", "16:40", 30, "evening"],
    ["下班後 60 分鐘內 → 對到", "23:00", 60, "evening"],
    ["下班後超過 → null", "23:01", 60, null],
  ])("%s", (_name, time, tolerance, expected) => {
    expect(
      closestEntryAt([morning, noon, evening], at(time), tolerance)?.id ?? null,
    ).toBe(expected);
  });

  it("一樣近 → 取上班較早的", () => {
    const early = entry("early", "08:00", "12:00");
    const late = entry("late", "10:00", "14:00");
    expect(closestEntryAt([late, early], at("09:00"), 60)?.id).toBe("early");
  });
});

const task = (
  demandId: string,
  role: string,
  positionKey: string,
  start: string,
): FilledTask => ({
  demandId,
  taskId: `${demandId}-t`,
  role,
  taskKey: role === "leader" ? "store-and-accounts-lead" : "store-duties",
  positionKey,
  demandStartAt: at(start),
});

describe("任務快照(規格 14.9)", () => {
  it.each([
    [
      "同崗位兩筆重疊 → 先負責",
      [
        task("d1", "helper", "counter", "08:00"),
        task("d2", "leader", "counter", "09:00"),
      ],
      "d2",
    ],
    [
      "同崗位、職責相同 → 開始較早的",
      [
        task("d1", "helper", "counter", "10:00"),
        task("d2", "helper", "counter", "08:30"),
      ],
      "d2",
    ],
    [
      "只有一筆同崗位 → 那一筆",
      [
        task("d1", "leader", "restock", "08:00"),
        task("d2", "helper", "counter", "08:30"),
      ],
      "d2",
    ],
    ["沒有同崗位 → null", [task("d1", "leader", "restock", "08:00")], null],
    ["沒有填進任何執行任務 → null", [], null],
  ])("%s", (_name, tasks, expected) => {
    expect(taskSnapshotOf(tasks, "counter")?.demandId ?? null).toBe(expected);
  });
});
