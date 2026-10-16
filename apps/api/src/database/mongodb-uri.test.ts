import os from "node:os";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MONGOOSE_MODULE_OPTIONS } from "@nestjs/mongoose/dist/mongoose.constants";
import { Test } from "@nestjs/testing";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

import {
  TEST_JWT_SECRET,
  buildDatabaseUri,
} from "../auth/test-support/auth-app";
import { SeedRuntimeModule } from "../seed/seed-runtime.module";
import { MONGODB_URI_ENV, requireMongoDbUri } from "./mongodb-uri";
import { HOOK_TIMEOUT_MS } from "./test-support/mongo-connection";

/** 第一次載入整張 AppModule 依賴圖(ts-jest 轉譯)很慢,放寬逾時。 */
jest.setTimeout(180_000);

const MISSING_MESSAGE =
  "缺少 MONGODB_URI 環境變數(MongoDB 連線字串;沒有預設值,本地見 .env.example)";

/** 缺席的三種樣子:沒設、空字串、純空白。 */
const MISSING_VALUES: [string, string | undefined][] = [
  ["未設定", undefined],
  ["空字串", ""],
  ["純空白", " \t\n "],
];

/** 設定或拿掉環境變數(指派 undefined 會變成字串 "undefined")。 */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

describe("requireMongoDbUri", () => {
  it.each(MISSING_VALUES)("%s → 拒絕,錯誤只指名變數", (_label, value) => {
    expect(() => requireMongoDbUri(value)).toThrow(new Error(MISSING_MESSAGE));
  });

  it("合法的非空字串原樣回傳:不修剪、不改寫", () => {
    const uri = " mongodb://someone:p%40ss@db.example:27018/tenant?tls=true ";

    expect(requireMongoDbUri(uri)).toBe(uri);
  });
});

/**
 * 兩個 Nest 連線 factory 的真接線:`AppModule`(api HTTP 服務、schema CLI)與 `SeedRuntimeModule`(受管定義 CLI)。
 * 缺連線字串時組裝就失敗,不會落到任何內建的本機資料庫;有給時 driver 拿到的就是環境變數的原值。
 */
describe("連線 factory 的 MONGODB_URI 接線", () => {
  const originalEnv = {
    uri: process.env[MONGODB_URI_ENV],
    jwtSecret: process.env.JWT_SECRET,
  };
  let appModule: Type;
  let memoryServer: MongoMemoryReplSet | undefined;
  let databaseUri: string;

  beforeAll(async () => {
    let baseUri = originalEnv.uri;
    if (!baseUri) {
      memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      baseUri = memoryServer.getUri();
    }
    databaseUri = buildDatabaseUri(baseUri, "cookhome-test-mongodb-uri");
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    // AppModule 的 ConfigModule 在載入當下讀工作目錄的 `.env`:載入時把工作目錄換到 repo 之外,
    // 開發者自己的 apps/api/.env 不會把連線字串補回來
    const originalCwd = process.cwd();
    process.chdir(os.tmpdir());
    try {
      ({ AppModule: appModule } = await import("../app.module"));
    } finally {
      process.chdir(originalCwd);
    }
  }, HOOK_TIMEOUT_MS * 3);

  afterAll(async () => {
    setEnv(MONGODB_URI_ENV, originalEnv.uri);
    setEnv("JWT_SECRET", originalEnv.jwtSecret);
    const connection = await mongoose.createConnection(databaseUri).asPromise();
    await connection.dropDatabase();
    await connection.close();
    await memoryServer?.stop();
  }, HOOK_TIMEOUT_MS);

  describe.each(MISSING_VALUES)("%s", (_label, value) => {
    it("AppModule 組裝失敗", async () => {
      setEnv(MONGODB_URI_ENV, value);

      await expect(
        Test.createTestingModule({ imports: [appModule] }).compile(),
      ).rejects.toThrow(new Error(MISSING_MESSAGE));
    });

    it("SeedRuntimeModule 組裝失敗", async () => {
      setEnv(MONGODB_URI_ENV, value);

      await expect(
        NestFactory.createApplicationContext(SeedRuntimeModule, {
          logger: false,
          abortOnError: false,
        }),
      ).rejects.toThrow(new Error(MISSING_MESSAGE));
    });
  });

  it("AppModule:有給連線字串時原樣交給 driver", async () => {
    setEnv(MONGODB_URI_ENV, databaseUri);

    const moduleRef = await Test.createTestingModule({
      imports: [appModule],
    }).compile();
    try {
      expect(
        moduleRef.get<{ uri: string }>(MONGOOSE_MODULE_OPTIONS, {
          strict: false,
        }).uri,
      ).toBe(databaseUri);
    } finally {
      await moduleRef.close();
    }
  });
});
