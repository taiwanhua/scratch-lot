import { describe, expect, it } from "@jest/globals";

import {
  MAKEUP_PUNCH_NO_ENTRY,
  attendanceOf,
  earlyLeaveMinutesOf,
  lateMinutesOf,
  makeupPunchEntryIdOf,
  makeupPunchValuesOf,
} from "./attendance";

const at = (time: string) => new Date(`2026-11-04T${time}+08:00`);

describe("遲到 / 早退(規格 14.2 寬限、14.7 依分店(日))", () => {
  // 班 08:30–14:30,寬限 5 分鐘
  it.each([
    ["08:30:00", 0],
    ["08:34:59", 0],
    ["08:35:00", 0],
    ["08:35:01", 6],
    ["08:41:00", 11],
    ["08:20:00", 0],
  ])("上班卡 %s → 遲到 %i 分(5:00 不算、5:01 算)", (time, expected) => {
    expect(lateMinutesOf(at("08:30:00"), at(time), 5)).toBe(expected);
  });

  it.each([
    ["14:30:00", 0],
    ["14:25:00", 0],
    ["14:24:59", 6],
    ["14:12:00", 18],
    ["14:40:00", 0],
  ])("下班卡 %s → 早退 %i 分(5:00 不算、5:01 算)", (time, expected) => {
    expect(earlyLeaveMinutesOf(at("14:30:00"), at(time), 5)).toBe(expected);
  });

  it("寬限 0:晚 1 秒就算遲到 1 分", () => {
    expect(lateMinutesOf(at("08:30:00"), at("08:30:01"), 0)).toBe(1);
  });

  it("沒打卡 → 不算遲到 / 早退(另外算未到、缺卡)", () => {
    expect(lateMinutesOf(at("08:30:00"), null, 5)).toBe(0);
    expect(earlyLeaveMinutesOf(at("14:30:00"), null, 5)).toBe(0);
  });
});

describe("attendanceOf:一筆排班的出勤", () => {
  const entry = {
    startAt: at("08:30:00"),
    endAt: at("14:30:00"),
    breakMinutes: 30,
  };
  const grace = { lateGraceMinutes: 5, earlyLeaveGraceMinutes: 5 };

  it("有上下班卡:已到、實際工時 = 下班 − 上班 − 休息、排班工時", () => {
    expect(
      attendanceOf(
        entry,
        at("08:41:00"),
        at("14:33:00"),
        grace,
        at("20:00:00"),
      ),
    ).toEqual({
      status: "arrived",
      lateMinutes: 11,
      earlyLeaveMinutes: 0,
      workedMinutes: 322,
      scheduledMinutes: 330,
    });
  });

  it("班已開始、沒有上班卡 → 未到;實際工時 null", () => {
    expect(
      attendanceOf(entry, null, null, grace, at("09:00:00")),
    ).toMatchObject({ status: "absent", workedMinutes: null });
  });

  it("班還沒開始、沒有上班卡 → 未開始", () => {
    expect(attendanceOf(entry, null, null, grace, at("08:00:00")).status).toBe(
      "upcoming",
    );
  });

  it("只有上班卡 → 已到、實際工時 null", () => {
    expect(
      attendanceOf(entry, at("08:30:00"), null, grace, at("20:00:00")),
    ).toMatchObject({ status: "arrived", workedMinutes: null });
  });
});

describe("補打卡申請的「對應排班」欄位值", () => {
  it("排班 id 照回;「沒有排班(臨時代班)」→ null;沒選 → undefined", () => {
    expect(makeupPunchEntryIdOf("6560f0000000000000000001")).toBe(
      "6560f0000000000000000001",
    );
    expect(makeupPunchEntryIdOf(MAKEUP_PUNCH_NO_ENTRY)).toBeNull();
    expect(makeupPunchEntryIdOf("")).toBeUndefined();
    expect(makeupPunchEntryIdOf(null)).toBeUndefined();
    expect(makeupPunchEntryIdOf(3)).toBeUndefined();
  });
});

describe("makeupPunchValuesOf:表單存值 → 補打卡申請的欄位", () => {
  it("解析各欄(引用存 { id, label }、類別選項存 { value, label })", () => {
    expect(
      makeupPunchValuesOf({
        punch_at: "2026-11-03T06:35:00.000Z",
        branch: { id: "b1", label: "中山店" },
        entry: "none",
        punch_type: "out",
        reason: { value: "forgot-punch", label: "忘記打卡" },
        note: "  ",
      }),
    ).toEqual({
      punchAt: new Date("2026-11-03T06:35:00.000Z"),
      branchId: "b1",
      entryId: null,
      punchType: "out",
      reasonKey: "forgot-punch",
      note: null,
    });
  });

  it("格式不對的欄位是 null;沒選對應排班是 undefined", () => {
    expect(
      makeupPunchValuesOf({ punch_at: "x", punch_type: "lunch" }),
    ).toMatchObject({
      punchAt: null,
      branchId: null,
      entryId: undefined,
      punchType: null,
      reasonKey: null,
    });
  });
});
