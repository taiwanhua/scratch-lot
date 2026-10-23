import { GraphQLISODateTime } from "@nestjs/graphql";
import { GraphQLError, Kind, type ValueNode, print } from "graphql";

import { isDateTimeString } from "@repo/domain/form";

/**
 * GraphQL `DateTime` 輸入只收完整的時點:帶時間與時區(`Z` 或 `±hh:mm`)的 ISO 8601 字串,
 * 判斷用 domain 的 `isDateTimeString`(和前後端換算時點同一條規則)。
 * 只有日期(`2026-12-15`)、沒帶時區(`2026-12-15T00:00`)、不存在的日期、非字串一律拒收,
 * 回 GraphQL 輸入錯誤(變數 → `BAD_USER_INPUT`,字面值 → `GRAPHQL_VALIDATION_FAILED`)。
 *
 * 為什麼改 `GraphQLISODateTime` 本身:它原本用 `new Date(value)` 解析,只有日期的字串會被當成 UTC 00:00,
 * UTC− 的租戶時區因此靜默變成前一天;壞字串則變成 Invalid Date 往下傳。
 * code-first 的 `@Field(() => GraphQLISODateTime)` 直接拿這個物件建 schema,`scalarsMap` 只管 `Date` 型別推導、
 * 管不到明確寫出的參照;所以把這個物件的兩個輸入解析換成嚴格版,所有 `DateTime` 欄位(含日後新增的)一起生效,
 * 呼叫端照舊寫 `GraphQLISODateTime`。輸出(`serialize`)不變,仍是 `toISOString()`。
 *
 * 由 `app.module.ts` 在組 GraphQLModule 前呼叫;重複呼叫無副作用。
 */
export function applyStrictDateTimeInput(): void {
  GraphQLISODateTime.parseValue = parseDateTimeValue;
  GraphQLISODateTime.parseLiteral = parseDateTimeLiteral;
}

const EXPECTED =
  "DateTime 要是帶時間與時區(Z 或 ±hh:mm)的 ISO 8601 時點,例如 2026-12-15T00:00:00+08:00";

/** 變數(JSON)的值 → `Date`;不是完整時點就丟錯。 */
export function parseDateTimeValue(value: unknown): Date {
  if (!isDateTimeString(value)) {
    throw new GraphQLError(`${EXPECTED};收到 ${JSON.stringify(value)}`);
  }
  return new Date(value);
}

/** 查詢字面值 → `Date`;只收字串字面值,規則同 `parseDateTimeValue`。 */
export function parseDateTimeLiteral(ast: ValueNode): Date {
  if (ast.kind !== Kind.STRING) {
    throw new GraphQLError(`${EXPECTED};收到 ${print(ast)}`, { nodes: ast });
  }
  return parseDateTimeValue(ast.value);
}
