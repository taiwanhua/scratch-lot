import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Connection } from "mongoose";

import {
  ROOT_ADMIN,
  buildDatabaseUri,
  seedDatabase,
} from "../../auth/test-support/auth-app";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { field } from "../../forms/test-support/form-fixtures";
import { DefinitionSeedService } from "../../seed/definition-seed.service";
import { ROOT_ADMIN_ACCOUNT_ENV } from "../../seed/seed-operator.service";
import {
  MONGODB_URI_ENV,
  SeedRuntimeModule,
} from "../../seed/seed-runtime.module";
import {
  formSeed,
  holdSeedLock,
  seedRequest,
} from "../../seed/test-support/seed-fixtures";
import { PROJECT_FIXTURE_LOOKUP_KEY } from "./project-fixture-lookup";

/**
 * 受管定義 CLI 的最小組裝(`SeedRuntimeModule`,沒有 `ProjectModule`)也拿到同一份專案 lookup 來源:
 * 清單由 `DatabaseModule` 從固定入口 `project/lookup-providers.ts` 提供。只替換資料登記與 lookup 來源兩份專案來源。
 */
jest.mock("../../project/database/registrations", () => {
  const actual = jest.requireActual<
    typeof import("../../project/database/registrations")
  >("../../project/database/registrations");
  const fixture = jest.requireActual<typeof import("./database/registrations")>(
    "./database/registrations",
  );
  return {
    PROJECT_DATABASE_REGISTRATIONS: [
      ...actual.PROJECT_DATABASE_REGISTRATIONS,
      ...fixture.PROJECT_FIXTURE_DATABASE_REGISTRATIONS,
    ],
  };
});
jest.mock("../../project/lookup-providers", () => {
  const actual = jest.requireActual<
    typeof import("../../project/lookup-providers")
  >("../../project/lookup-providers");
  const fixture = jest.requireActual<typeof import("./project-fixture-lookup")>(
    "./project-fixture-lookup",
  );
  return {
    PROJECT_LOOKUP_PROVIDERS: [
      ...actual.PROJECT_LOOKUP_PROVIDERS,
      ...fixture.PROJECT_FIXTURE_LOOKUP_PROVIDERS,
    ],
  };
});

jest.setTimeout(HOOK_TIMEOUT_MS * 3);

/** 一份引用某 lookup 來源的表單宣告。 */
const referencing = (key: string, provider: string) =>
  formSeed(key, "r1", {
    fields: [
      field("title", "text"),
      field("item", "reference", {
        source: { provider, labelField: "name" },
      }),
    ],
  });

describe("受管定義 CLI 的組裝:發布引用專案 lookup 來源的表單", () => {
  let memoryServer: MongoMemoryServer | undefined;
  let connection: Connection;
  let context: INestApplicationContext;
  const originalEnv = {
    uri: process.env[MONGODB_URI_ENV],
    account: process.env[ROOT_ADMIN_ACCOUNT_ENV],
  };

  beforeAll(async () => {
    let baseUri = originalEnv.uri;
    if (!baseUri) {
      memoryServer = await MongoMemoryServer.create();
      baseUri = memoryServer.getUri();
    }
    const uri = buildDatabaseUri(baseUri, "cookhome-test-project-lookup-seed");
    await seedDatabase(uri);
    connection = await mongoose.createConnection(uri).asPromise();
    await holdSeedLock(connection);
    process.env[MONGODB_URI_ENV] = uri;
    process.env[ROOT_ADMIN_ACCOUNT_ENV] = ROOT_ADMIN.account;
    context = await NestFactory.createApplicationContext(SeedRuntimeModule, {
      logger: false,
      abortOnError: false,
    });
  }, HOOK_TIMEOUT_MS * 3);

  afterAll(async () => {
    await context.close();
    await connection.dropDatabase();
    await connection.close();
    await memoryServer?.stop();
    for (const [name, value] of [
      [MONGODB_URI_ENV, originalEnv.uri],
      [ROOT_ADMIN_ACCOUNT_ENV, originalEnv.account],
    ] as const) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }, HOOK_TIMEOUT_MS);

  it("檢查器認得專案來源:安裝成功發布;未登錄的來源照樣擋下", async () => {
    const seeds = context.get(DefinitionSeedService);
    const applied = await seeds.execute(
      seedRequest([
        referencing("seed_project_lookup", PROJECT_FIXTURE_LOOKUP_KEY),
      ]),
    );
    expect(applied.errors).toEqual([]);
    expect(applied.results).toMatchObject([
      { outcome: "created", localVersion: 1 },
    ]);

    const rejected = await seeds.execute(
      seedRequest([referencing("seed_unknown_lookup", "fixture_unknown")]),
    );
    expect(rejected.results).toMatchObject([
      {
        key: "seed_unknown_lookup",
        outcome: null,
        conflict: {
          code: "DEFINITION_INVALID",
          message: expect.stringContaining("LOOKUP_UNKNOWN_PROVIDER"),
        },
      },
    ]);
  });
});
