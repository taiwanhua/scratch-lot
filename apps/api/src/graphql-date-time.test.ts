import { describe, expect, it } from "@jest/globals";
import { GraphQLISODateTime } from "@nestjs/graphql";
import { Kind, parseValue } from "graphql";

import {
  applyStrictDateTimeInput,
  parseDateTimeLiteral,
  parseDateTimeValue,
} from "./graphql-date-time";

/** 寬鬆的解析(模擬沒換掉的原版)。 */
const looseParse = (value: unknown) => new Date(String(value));

describe("DateTime 輸入只收完整時點", () => {
  it.each([
    ["2026-12-15T00:00:00.000Z", "2026-12-15T00:00:00.000Z"],
    ["2026-12-15T00:00:00+08:00", "2026-12-14T16:00:00.000Z"],
    ["2026-12-15T00:00-08:00", "2026-12-15T08:00:00.000Z"],
    // 毫秒以下的位數照 Date 截到毫秒;時區不帶冒號(ISO 8601 基本格式)也收
    ["2026-12-15T00:00:00.123456789Z", "2026-12-15T00:00:00.123Z"],
    ["2026-12-15T00:00:00+0800", "2026-12-14T16:00:00.000Z"],
    ["2028-02-29T00:00:00Z", "2028-02-29T00:00:00.000Z"],
  ])("收 %s", (input, expected) => {
    expect(parseDateTimeValue(input).toISOString()).toBe(expected);
  });

  it.each([
    ["只有日期", "2026-12-15"],
    ["沒帶時區", "2026-12-15T00:00:00"],
    ["不存在的日期", "2026-02-30T00:00:00Z"],
    ["平年 2/29", "2026-02-29T00:00:00Z"],
    ["不存在的時刻", "2026-12-15T25:00:00Z"],
    ["時區只有小時", "2026-12-15T00:00:00+08"],
    ["小寫 z", "2026-12-15T00:00:00z"],
    ["日期與時間用空白隔開", "2026-12-15 00:00:00Z"],
    ["沒有分鐘", "2026-12-15T00Z"],
    ["不是日期", "tomorrow"],
    ["空字串", ""],
    ["數字", 1_765_000_000_000],
    ["null", null],
  ])("拒收%s", (_label, input) => {
    expect(() => parseDateTimeValue(input)).toThrow(/DateTime/u);
  });

  it("字面值:字串照同一條規則,非字串拒收", () => {
    expect(
      parseDateTimeLiteral(parseValue('"2026-12-15T00:00:00Z"')).toISOString(),
    ).toBe("2026-12-15T00:00:00.000Z");
    expect(() => parseDateTimeLiteral(parseValue('"2026-12-15"'))).toThrow(
      /DateTime/u,
    );
    expect(() => parseDateTimeLiteral({ kind: Kind.INT, value: "1" })).toThrow(
      /DateTime/u,
    );
  });

  it("裝到 GraphQLISODateTime 上:所有 DateTime 欄位一起生效,輸出格式不變;重複呼叫結果相同", () => {
    applyStrictDateTimeInput();
    applyStrictDateTimeInput();
    expect(GraphQLISODateTime.parseValue).toBe(parseDateTimeValue);
    expect(GraphQLISODateTime.parseLiteral).toBe(parseDateTimeLiteral);
    expect(() => GraphQLISODateTime.parseValue("2026-12-15")).toThrow(
      /DateTime/u,
    );
    expect(
      GraphQLISODateTime.serialize(new Date("2026-12-15T00:00:00+08:00")),
    ).toBe("2026-12-14T16:00:00.000Z");
  });

  it("換不掉(例如升級後屬性變成唯讀存取子)→ 啟動失敗,不靜默退回寬鬆解析", () => {
    const original = Object.getOwnPropertyDescriptor(
      GraphQLISODateTime,
      "parseValue",
    );
    Object.defineProperty(GraphQLISODateTime, "parseValue", {
      configurable: true,
      get: () => looseParse,
      set: () => {
        // 模擬升級後換不掉:寫入被忽略
      },
    });
    try {
      expect(() => {
        applyStrictDateTimeInput();
      }).toThrow(/GQL-08/u);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(GraphQLISODateTime, "parseValue", original);
      }
      applyStrictDateTimeInput();
    }
  });
});
