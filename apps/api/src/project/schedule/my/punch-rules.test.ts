import { describe, expect, it } from "@jest/globals";

import {
  type EntryLike,
  type PunchLike,
  canPunchEntry,
  duplicatePunchIdsOf,
  effectivePunchesOf,
  incompleteEntriesOf,
  missingPunchesOf,
  openUnmatchedClockInOf,
  punchableEntriesOf,
} from "./punch-rules";

const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

const entry = (
  id: string,
  date: string,
  start: string,
  end: string,
): EntryLike => ({ id, date, startAt: at(date, start), endAt: at(date, end) });

const punch = (
  id: string,
  entryId: string | null,
  type: "in" | "out",
  date: string,
  time: string,
): PunchLike => ({ id, entryId, type, at: at(date, time) });

describe("打卡規則(規格 14.6)", () => {
  it("同一班打兩次上班卡 → 第二筆標重複;上班取最早、下班取最晚", () => {
    const punches = [
      punch("in1", "e1", "in", "2026-11-05", "08:24"),
      punch("in2", "e1", "in", "2026-11-05", "08:30"),
      punch("out1", "e1", "out", "2026-11-05", "14:30"),
      punch("out2", "e1", "out", "2026-11-05", "14:36"),
    ];
    expect(duplicatePunchIdsOf(punches)).toEqual(new Set(["in2", "out1"]));
    expect(effectivePunchesOf("e1", punches)).toEqual({
      clockIn: at("2026-11-05", "08:24"),
      clockOut: at("2026-11-05", "14:36"),
    });
  });

  it("補打卡較早的上班卡:原本生效的那張改成重複", () => {
    const punches = [
      punch("button", "e1", "in", "2026-11-05", "08:40"),
      punch("makeup", "e1", "in", "2026-11-05", "08:28"),
    ];
    expect(duplicatePunchIdsOf(punches)).toEqual(new Set(["button"]));
  });

  it("不同班各自計算;未對應排班的卡不標重複", () => {
    const punches = [
      punch("a", "e1", "in", "2026-11-05", "08:30"),
      punch("b", "e2", "in", "2026-11-05", "17:00"),
      punch("c", null, "in", "2026-11-05", "09:00"),
      punch("d", null, "in", "2026-11-05", "09:05"),
    ];
    expect(duplicatePunchIdsOf(punches)).toEqual(new Set());
  });

  it("打卡不完整:已結束的班缺下班卡 → 列出;還沒結束 → 不列", () => {
    const morning = entry("m", "2026-11-05", "08:30", "14:30");
    const punches = [punch("p", "m", "in", "2026-11-05", "08:25")];
    // 14:00:班還沒結束
    expect(
      missingPunchesOf(morning, punches, at("2026-11-05", "14:00")),
    ).toEqual([]);
    // 14:30 下班時點到了:缺下班卡
    expect(
      missingPunchesOf(morning, punches, at("2026-11-05", "14:30")),
    ).toEqual(["out"]);
    // 上下班都沒打
    expect(missingPunchesOf(morning, [], at("2026-11-06", "09:00"))).toEqual([
      "in",
      "out",
    ]);
  });

  it("打卡不完整清單:只看範圍內已結束的班,依上班時點排序", () => {
    const entries = [
      entry("old", "2026-10-28", "08:30", "14:30"),
      entry("b", "2026-11-04", "14:30", "22:00"),
      entry("a", "2026-11-02", "08:00", "14:30"),
      entry("ok", "2026-11-03", "08:00", "14:30"),
      entry("now", "2026-11-05", "08:30", "14:30"),
    ];
    const punches = [
      punch("1", "a", "in", "2026-11-02", "07:56"),
      punch("2", "b", "in", "2026-11-04", "14:24"),
      punch("3", "ok", "in", "2026-11-03", "08:00"),
      punch("4", "ok", "out", "2026-11-03", "14:31"),
    ];
    const result = incompleteEntriesOf(
      entries,
      punches,
      at("2026-11-05", "10:00"),
      { from: "2026-10-30", to: "2026-11-05" },
    );
    expect(result.map((item) => [item.entry.id, item.missing])).toEqual([
      ["a", ["out"]],
      ["b", ["out"]],
    ]);
  });

  it("打卡區:今天的班 + 昨天未打下班卡的班;昨天的只能打下班卡", () => {
    const today = entry("t", "2026-11-05", "08:30", "14:30");
    const yesterdayOpen = entry("y1", "2026-11-04", "14:30", "22:00");
    const yesterdayDone = entry("y2", "2026-11-04", "08:00", "12:00");
    const older = entry("o", "2026-11-03", "08:00", "12:00");
    const punches = [punch("p", "y2", "out", "2026-11-04", "12:01")];
    const days = { today: "2026-11-05", yesterday: "2026-11-04" };
    expect(
      punchableEntriesOf(
        [yesterdayOpen, older, yesterdayDone, today],
        punches,
        days,
      ).map((item) => [item.entry.id, item.day]),
    ).toEqual([
      ["t", "today"],
      ["y1", "yesterday"],
    ]);
    expect(canPunchEntry(today, "in", punches, days)).toBe(true);
    expect(canPunchEntry(yesterdayOpen, "out", punches, days)).toBe(true);
    expect(canPunchEntry(yesterdayOpen, "in", punches, days)).toBe(false);
    expect(canPunchEntry(yesterdayDone, "out", punches, days)).toBe(false);
    expect(canPunchEntry(older, "out", punches, days)).toBe(false);
  });

  it("沒有排班:最後一張未對應排班的卡是上班卡 → 還開著", () => {
    const open = punch("in", null, "in", "2026-11-05", "09:00");
    expect(openUnmatchedClockInOf([open])).toBe(open);
    expect(
      openUnmatchedClockInOf([
        open,
        punch("out", null, "out", "2026-11-05", "13:00"),
      ]),
    ).toBeNull();
    expect(
      openUnmatchedClockInOf([punch("x", "e1", "in", "2026-11-05", "09:00")]),
    ).toBeNull();
  });
});
