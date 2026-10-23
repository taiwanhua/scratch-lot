import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import { GraphQLScalarType } from "graphql";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "./auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "./database/test-support/mongo-connection";
import { parseDateTimeLiteral, parseDateTimeValue } from "./graphql-date-time";

/**
 * 嚴格的 `DateTime` 輸入是對 `@nestjs/graphql` 的 `GraphQLISODateTime` 的全域修補(GQL-08)。
 * 這裡不自己呼叫 `applyStrictDateTimeInput`,只啟動 AppModule、從它建好的 schema 讀 `DateTime`:
 * `app.module.ts` 沒套用、套用晚於建 schema、或升級後 schema 不再用那個物件,這裡都會紅。
 * (另放一個檔:`graphql-date-time.test.ts` 會自己套用,同一個檔裡會遮掉沒套用的情況。)
 */
describe("啟動後 schema 的 DateTime 用嚴格的輸入解析", () => {
  let api: AuthTestApp;

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-graphql-date-time");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("schema 的 DateTime 是換過的解析,只有日期的字串被拒收", () => {
    const { schema } = api.app.get(GraphQLSchemaHost);
    const scalar = schema.getType("DateTime");
    expect(scalar).toBeInstanceOf(GraphQLScalarType);
    const dateTime = scalar as GraphQLScalarType;
    expect(dateTime.parseValue).toBe(parseDateTimeValue);
    expect(dateTime.parseLiteral).toBe(parseDateTimeLiteral);
    expect(() => dateTime.parseValue("2026-12-15")).toThrow(/DateTime/u);
    expect(dateTime.serialize(new Date("2026-12-15T00:00:00+08:00"))).toBe(
      "2026-12-14T16:00:00.000Z",
    );
  });
});
