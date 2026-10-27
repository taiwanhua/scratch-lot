import { describe, expect, it } from "@jest/globals";

import { buildWorkbook } from "./reports/excel";
import {
  ATTENDANCE_SHEET_COLUMNS,
  type AttendanceSheetRow,
  type AttendanceSheetText,
  attendanceSheetsOf,
  defaultCheckedPunchIds,
  duplicatePunchIdsOfDay,
  hoursOf,
  punchSpanOf,
  unmatchedCountsByDate,
} from "./schedule-attendance";

const TZ = "Asia/Taipei";
const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString();

const HEADERS = {
  date: "日期",
  person: "人員",
  entry: "排班",
  clockIn: "上班",
  clockOut: "下班",
  onDutyHours: "在班時數",
  breakMinutes: "休息",
  workedHours: "實際工時",
  scheduledHours: "排班工時",
  lateMinutes: "遲到",
  earlyLeaveMinutes: "早退",
  specialDayCategory: "特殊日類別",
  makeupNote: "補卡註記",
} as const;

const TEXT: AttendanceSheetText = {
  headers: HEADERS,
  temporary: "臨",
  makeup: "補卡",
  note: "2026 年 11 月",
};

const row = (
  overrides: Partial<AttendanceSheetRow> = {},
): AttendanceSheetRow => ({
  date: "2026-11-04",
  userName: "王小明",
  orgName: "中山店",
  startAt: at("2026-11-04", "08:30"),
  endAt: at("2026-11-04", "14:30"),
  breakMinutes: 30,
  shortName: "早",
  clockIn: at("2026-11-04", "08:41"),
  clockOut: at("2026-11-04", "14:33"),
  lateMinutes: 11,
  earlyLeaveMinutes: 0,
  workedMinutes: 322,
  scheduledMinutes: 330,
  specialDayCategory: null,
  hasMakeup: false,
  ...overrides,
});

describe("出勤紀錄的 Excel(規格 14.7)", () => {
  it("2 家分店 → 2 個工作表,欄位順序照規格(前面多日期與人員);讀回 workbook", async () => {
    const sheets = attendanceSheetsOf(
      [
        { orgName: "中山店", rows: [row()] },
        {
          orgName: "新竹店",
          rows: [
            row({
              orgName: "新竹店",
              shortName: null,
              clockOut: null,
              workedMinutes: null,
              lateMinutes: 0,
              specialDayCategory: "店慶",
              hasMakeup: true,
            }),
          ],
        },
      ],
      TEXT,
      TZ,
    );
    const workbook = await buildWorkbook({ sheets });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "中山店",
      "新竹店",
    ]);
    const first = workbook.getWorksheet("中山店");
    // 第 1 列是說明、第 2 列是表頭
    expect(first?.getRow(1).getCell(1).value).toBe("2026 年 11 月");
    expect(
      ATTENDANCE_SHEET_COLUMNS.map(
        (_, index) => first?.getRow(2).getCell(index + 1).value,
      ),
    ).toEqual([
      "日期",
      "人員",
      "排班",
      "上班",
      "下班",
      "在班時數",
      "休息",
      "實際工時",
      "排班工時",
      "遲到",
      "早退",
      "特殊日類別",
      "補卡註記",
    ]);
    expect(
      ATTENDANCE_SHEET_COLUMNS.map(
        (_, index) => first?.getRow(3).getCell(index + 1).value,
      ),
    ).toEqual([
      "2026-11-04",
      "王小明",
      "早 08:30–14:30",
      "08:41",
      "14:33",
      5.9,
      30,
      5.4,
      5.5,
      11,
      null,
      null,
      null,
    ]);
    const second = workbook.getWorksheet("新竹店");
    expect(
      ATTENDANCE_SHEET_COLUMNS.map(
        (_, index) => second?.getRow(3).getCell(index + 1).value,
      ),
    ).toEqual([
      "2026-11-04",
      "王小明",
      "臨 08:30–14:30",
      "08:41",
      null,
      null,
      30,
      null,
      5.5,
      null,
      null,
      "店慶",
      "補卡",
    ]);
  });

  it("小時一位小數", () => {
    expect(hoursOf(322)).toBe("5.4");
    expect(hoursOf(330)).toBe("5.5");
    expect(hoursOf(null)).toBeNull();
  });
});

describe("排班對話框的未對應排班的打卡(規格 14.5)", () => {
  const punches = [
    { id: "p1", type: "in", at: at("2026-11-05", "08:27") },
    { id: "p2", type: "in", at: at("2026-11-05", "08:31") },
    { id: "p3", type: "out", at: at("2026-11-05", "14:36") },
    { id: "p4", type: "out", at: at("2026-11-05", "20:00") },
  ];

  it("重複打卡:上班取最早、下班取最晚,其餘重複", () => {
    expect(
      [...duplicatePunchIdsOfDay(punches)].toSorted((a, b) =>
        a.localeCompare(b),
      ),
    ).toEqual(["p2", "p3"]);
  });

  it("預設勾選:排班前後容許時間內、重複打卡不勾;還沒有時間 = 不勾", () => {
    const span = {
      startAt: at("2026-11-05", "08:30"),
      endAt: at("2026-11-05", "14:30"),
    };
    // p3 是重複(p4 較晚),p4 在容許 60 分鐘外
    expect([...defaultCheckedPunchIds(punches, span, 60)]).toEqual(["p1"]);
    expect(
      [...defaultCheckedPunchIds(punches, span, 400)].toSorted((a, b) =>
        a.localeCompare(b),
      ),
    ).toEqual(["p1", "p4"]);
    expect(defaultCheckedPunchIds(punches, null, 60).size).toBe(0);
  });

  it("上下班時間改用打卡時間:勾選的上班卡最早、下班卡最晚;沒有那一種 = null", () => {
    expect(punchSpanOf(punches, new Set(["p1", "p2", "p3"]))).toEqual({
      startAt: at("2026-11-05", "08:27"),
      endAt: at("2026-11-05", "14:36"),
    });
    expect(punchSpanOf(punches, new Set(["p2"]))).toEqual({
      startAt: at("2026-11-05", "08:31"),
      endAt: null,
    });
  });

  it("月檢視每天的張數", () => {
    expect(
      unmatchedCountsByDate([
        { date: "2026-11-01" },
        { date: "2026-11-01" },
        { date: "2026-11-04" },
      ]),
    ).toEqual(
      new Map([
        ["2026-11-01", 2],
        ["2026-11-04", 1],
      ]),
    );
  });
});
