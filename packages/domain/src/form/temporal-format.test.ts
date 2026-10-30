/* eslint-disable import-x/no-named-as-default-member -- dayjs 的發佈檔是 UMD,具名的 `extend` 在 node ESM 解析不到(同 `@repo/ui` 的 zoned-day.ts)。到期條件:dayjs 提供真正的 ESM 具名匯出 */
import { describe, expect, it } from "@jest/globals";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utcPlugin from "dayjs/plugin/utc";

import {
  TEMPORAL_FORMAT_TOKENS,
  formatTemporal,
  formatTemporalPattern,
  isTemporalFormat,
} from "./temporal";

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

/** 對照組:dayjs 依同一個時區印同一個格式字串(token 意義的正本)。 */
const viaDayjs = (iso: string, pattern: string, timezone: string): string =>
  dayjs(iso).tz(timezone).format(pattern);

const INSTANTS = [
  "2026-10-29T01:00:00.000Z", // 台北 09:00
  "2026-10-29T09:05:07.042Z", // 台北 17:05:07
  "2026-12-31T16:30:00.000Z", // 台北跨年 00:30
  "2026-03-08T07:59:59.999Z", // 紐約夏令時間切換前後
  "2026-03-08T10:00:00.000Z",
  "2005-01-02T12:00:00.000Z", // 中午 12 點(12 時制)
  "2026-07-04T23:00:00.000Z",
];

const TIMEZONES = ["Asia/Taipei", "America/New_York", "UTC", "Asia/Kolkata"];

const PATTERNS = [
  "HH:mm",
  "YYYY/MM/DD",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD HH:mm:ss",
  "YY/M/D H:m:s",
  "hh:mm A",
  "h:mm a",
  "HH:mm:ss.SSS",
  "YYYY-MM-DD[T]HH:mm",
  "YYYY年M月D日 HH點mm分",
  "[at] HH:mm",
  "MM.DD",
  "YYYYMMDD",
  "[]HH:mm",
  "[[at]] HH:mm",
  "YYYY-MM-DD HH:mm:ss.SSS",
];

describe("格式字串(對齊 dayjs format)", () => {
  it.each(PATTERNS)("%s:每個時點、每個時區都和 dayjs 一致", (pattern) => {
    expect(isTemporalFormat(pattern)).toBe(true);
    for (const iso of INSTANTS) {
      for (const timezone of TIMEZONES) {
        expect(formatTemporalPattern(iso, pattern, timezone)).toBe(
          viaDayjs(iso, pattern, timezone),
        );
      }
    }
  });

  it("每個支援的 token 單獨用都和 dayjs 一致", () => {
    for (const token of TEMPORAL_FORMAT_TOKENS) {
      for (const iso of INSTANTS) {
        expect(formatTemporalPattern(iso, token, "Asia/Taipei")).toBe(
          viaDayjs(iso, token, "Asia/Taipei"),
        );
      }
    }
  });

  it("收 Date;空值 → 空字串;不是時點的字串原樣回;時區不合法 → UTC", () => {
    expect(
      formatTemporalPattern(
        new Date("2026-10-29T01:00:00.000Z"),
        "HH:mm",
        "Asia/Taipei",
      ),
    ).toBe("09:00");
    expect(formatTemporalPattern(null, "HH:mm", "Asia/Taipei")).toBe("");
    expect(formatTemporalPattern("舊資料", "HH:mm", "Asia/Taipei")).toBe(
      "舊資料",
    );
    expect(
      formatTemporalPattern("2026-10-29T01:00:00.000Z", "HH:mm", "Nowhere/X"),
    ).toBe("01:00");
  });

  it("不支援的 token、沒跳脫的英文字母、沒有 token、太長 → 不是可用的格式", () => {
    for (const pattern of [
      "",
      "time",
      "date",
      "MMM D",
      "dddd",
      "d",
      "Z",
      "YYYY-MM-DDTHH:mm",
      "Do",
      "X",
      "-",
      "[HH:mm]",
      "HH:mm".repeat(11),
    ]) {
      expect(isTemporalFormat(pattern)).toBe(false);
    }
    expect(isTemporalFormat(42)).toBe(false);
  });

  it("格式字串不合法 → 退回日期時間的預設顯示", () => {
    expect(
      formatTemporalPattern("2026-10-29T01:00:00.000Z", "MMM", "Asia/Taipei"),
    ).toBe(
      formatTemporal("2026-10-29T01:00:00.000Z", {
        type: "datetime",
        timezone: "Asia/Taipei",
      }),
    );
  });
});
