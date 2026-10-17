import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { MongooseModule } from "@nestjs/mongoose";
import { Test } from "@nestjs/testing";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { DatabaseModule } from "./database.module";
import { HOOK_TIMEOUT_MS } from "./test-support/mongo-connection";

/**
 * 資料範圍規則提供者的**啟動期斷言**(#246 的 6)。
 *
 * 在此之前查詢中介層找不到 provider 就只套租戶保底(fail-open):規則設了卻沒有人執行,
 * 而且不會有任何錯誤 —— 日後把 `DataScopeModule` 從 `AppModule` 拆掉就會靜默擴權。
 * 現在 `DatabaseModule.onApplicationBootstrap` 會斷言它已註冊,缺了就讓 app 起不來。
 *
 * 這一檔刻意**不掛 `DataScopeModule`**(那才是被驗的缺失情境);
 * 「掛了就起得來」的正向情境由 `data-scope/data-scope.test.ts` 起整個 AppModule 覆蓋。
 */
describe("DataScopeRuleProvider 未註冊時 app 起不來(#246 的 6)", () => {
  let memoryServer: MongoMemoryReplSet | undefined;
  let uri: string;

  beforeAll(async () => {
    const baseUri = process.env.MONGODB_URI;
    if (baseUri) {
      uri = baseUri;
    } else {
      memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      uri = memoryServer.getUri();
    }
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await memoryServer?.stop();
  }, HOOK_TIMEOUT_MS);

  it(
    "只掛 DatabaseModule(沒有 DataScopeModule)→ app.init() 失敗且訊息指出原因",
    async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot(uri, {
            dbName: "cookhome-test-data-scope-provider",
          }),
          DatabaseModule,
        ],
      }).compile();
      const app = moduleRef.createNestApplication();

      await expect(app.init()).rejects.toThrow(/DataScopeRuleProvider 未註冊/);
      await app.close();
    },
    HOOK_TIMEOUT_MS,
  );
});
