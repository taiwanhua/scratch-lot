import { describe, expect, it } from "@jest/globals";
import { GraphQLISODateTime } from "@nestjs/graphql";
import { Kind, parseValue } from "graphql";

import {
  applyStrictDateTimeInput,
  parseDateTimeLiteral,
  parseDateTimeValue,
} from "./graphql-date-time";

describe("DateTime 輸入只收完整時點", () => {
  it.each([
    ["2026-12-15T00:00:00.000Z", "2026-12-15T00:00:00.000Z"],
    ["2026-12-15T00:00:00+08:00", "2026-12-14T16:00:00.000Z"],
    ["2026-12-15T00:00-08:00", "2026-12-15T08:00:00.000Z"],
  ])("收 %s", (input, expected) => {
    expect(parseDateTimeValue(input).toISOString()).toBe(expected);
  });

  it.each([
    ["只有日期", "2026-12-15"],
    ["沒帶時區", "2026-12-15T00:00:00"],
    ["不存在的日期", "2026-02-30T00:00:00Z"],
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

  it("裝到 GraphQLISODateTime 上:所有 DateTime 欄位一起生效,輸出格式不變", () => {
    applyStrictDateTimeInput();
    expect(() => GraphQLISODateTime.parseValue("2026-12-15")).toThrow(
      /DateTime/u,
    );
    expect(
      GraphQLISODateTime.serialize(new Date("2026-12-15T00:00:00+08:00")),
    ).toBe("2026-12-14T16:00:00.000Z");
  });
});
