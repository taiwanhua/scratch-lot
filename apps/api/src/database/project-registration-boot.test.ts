import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Provider } from "@nestjs/common";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import type { DatabaseRegistration } from "./registration";
import { HOOK_TIMEOUT_MS } from "./test-support/mongo-connection";

/** 一份全新載入的模組(與被測的 `database.module.ts` 同一個模組登錄,plugin 記號才對得上)。 */
interface FreshModules {
  mongoose: typeof import("mongoose");
  nestMongoose: typeof import("@nestjs/mongoose");
  baseRepository: typeof import("./base.repository");
  baseRepositories: typeof import("./base/repositories");
  baseFields: typeof import("./plugins/base-fields.plugin");
  tenantScope: typeof import("./plugins/tenant-scope.plugin");
}

type ProjectRegistrations = (
  fresh: FreshModules,
) => readonly DatabaseRegistration[];

const MODEL = "BootItem";
const COLLECTION = "boot_items";

interface BootRegistrationOptions {
  key?: string;
  modelName?: string;
  collection?: string;
  checkKey?: string;
  /** repository 實際注入哪張 model(預設就是登記的那張;給別的 = 錯綁)。 */
  injectedModel?: string;
  plugins?: boolean;
  check?: boolean;
  /** 改用這個 token 登記 repository(驗 token 碰撞)。 */
  repositoryToken?: (fresh: FreshModules) => Provider;
  extraRepositories?: (fresh: FreshModules) => Provider[];
}

/** 示範模組形狀的專案登記;各選項各弄壞一處。 */
function bootRegistration(
  fresh: FreshModules,
  options: BootRegistrationOptions = {},
): DatabaseRegistration {
  const modelName = options.modelName ?? MODEL;
  const collection = options.collection ?? COLLECTION;
  const { Schema } = fresh.mongoose;
  const schema = new Schema(
    { orgId: { type: Schema.Types.ObjectId, required: true }, name: String },
    { collection },
  );
  if (options.plugins !== false) {
    schema.plugin(fresh.baseFields.baseFieldsPlugin);
    schema.plugin(fresh.tenantScope.tenantScopePlugin, { moduleData: true });
  }
  const { BaseRepository } = fresh.baseRepository;
  class BootItemsRepository extends BaseRepository<
    unknown,
    import("./base.repository").RepositoryDocument
  > {}
  const repository: Provider = options.repositoryToken?.(fresh) ?? {
    provide: BootItemsRepository,
    inject: [
      fresh.nestMongoose.getModelToken(options.injectedModel ?? modelName),
    ],
    useFactory: (model: ConstructorParameters<typeof BootItemsRepository>[0]) =>
      new BootItemsRepository(model),
  };
  const token =
    typeof repository === "function" ? repository : repository.provide;
  return {
    key: options.key ?? "boot",
    models: [{ name: modelName, collection, schema }],
    repositories: [
      { modelName, provider: repository },
      ...(options.extraRepositories?.(fresh) ?? []).map((provider) => ({
        modelName,
        provider,
      })),
    ],
    orgDataChecks:
      options.check === false
        ? []
        : [
            {
              key: options.checkKey ?? "boot.items",
              modelName,
              repository: token,
              ownerField: "orgId",
            },
          ],
  };
}

/**
 * 專案資料登記的**啟動負例**:只替換 `project/database/registrations.ts` 的內容,
 * 載入並啟動真的 `DatabaseModule`(不是另組一個測試 module)。
 * 每個案例各用一份全新的模組登錄,互不污染。
 *
 * 刻意不掛 `DataScopeModule`:合規的登記會一路走到「DataScopeRuleProvider 未註冊」那道既有的
 * 啟動檢查才失敗 —— 這就是「登記本身沒有被擋」的證據(對照組)。
 */
describe("專案資料登記:不合契約時真的 DatabaseModule 起不來", () => {
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

  /** 以指定的專案登記載入並啟動 `DatabaseModule`(不給 = 用正式的專案登記);失敗就把錯誤拋出來。 */
  async function boot(project?: ProjectRegistrations): Promise<void> {
    await jest.isolateModulesAsync(async () => {
      const mongoose = await import("mongoose");
      const fresh: FreshModules = {
        mongoose,
        nestMongoose: await import("@nestjs/mongoose"),
        baseRepository: await import("./base.repository"),
        baseRepositories: await import("./base/repositories"),
        baseFields: await import("./plugins/base-fields.plugin"),
        tenantScope: await import("./plugins/tenant-scope.plugin"),
      };
      if (project) {
        jest.doMock("../project/database/registrations", () => ({
          PROJECT_DATABASE_REGISTRATIONS: project(fresh),
        }));
      } else {
        // doMock 的登記跨 isolateModules 留著;明確解除才載得到正式來源
        jest.dontMock("../project/database/registrations");
      }
      const { Test } = await import("@nestjs/testing");
      try {
        const { DatabaseModule } = await import("./database.module");
        const moduleRef = await Test.createTestingModule({
          imports: [
            fresh.nestMongoose.MongooseModule.forRoot(uri, {
              dbName: "cookhome-test-project-registration-boot",
            }),
            DatabaseModule,
          ],
        }).compile();
        const app = moduleRef.createNestApplication();
        try {
          await app.init();
        } finally {
          await app.close();
        }
      } finally {
        // 建立 provider 途中失敗時 Nest 不會替我們關連線;留著會讓 jest 收不了尾
        await Promise.all(
          mongoose.default.connections.map((connection) => connection.close()),
        );
      }
    });
  }

  it(
    "對照組:合規的專案登記通過全部登記檢查,只卡在既有的 DataScopeRuleProvider 啟動檢查",
    async () => {
      await expect(boot((fresh) => [bootRegistration(fresh)])).rejects.toThrow(
        /DataScopeRuleProvider 未註冊/,
      );
    },
    HOOK_TIMEOUT_MS,
  );

  it(
    "正式的專案登記(不替換)通過全部登記檢查,同樣只卡在 DataScopeRuleProvider 啟動檢查",
    async () => {
      await expect(boot()).rejects.toThrow(/DataScopeRuleProvider 未註冊/);
    },
    HOOK_TIMEOUT_MS,
  );

  it.each<[string, BootRegistrationOptions, RegExp]>([
    ["登記 key 撞底座", { key: "accounts" }, /登記 key「accounts」重複/],
    ["model 名撞底座", { modelName: "Customer" }, /model「Customer」重複/],
    [
      "collection 撞底座",
      { collection: "customers" },
      /collection「customers」重複/,
    ],
    [
      "repository token 撞底座(同一個 class 本體)",
      {
        repositoryToken: (fresh) => fresh.baseRepositories.CustomersRepository,
      },
      /repository token「CustomersRepository」重複/,
    ],
    [
      "檢查 key 撞底座",
      { checkKey: "base.customers" },
      /檢查 key「base\.customers」重複/,
    ],
    ["缺租戶 plugin", { plugins: false }, /BootItem.*baseFieldsPlugin/],
    ["漏組織歸屬檢查", { check: false }, /BootItem.*沒有組織歸屬檢查/],
  ])(
    "%s:載入組裝入口時就失敗",
    async (_label, options, message) => {
      await expect(
        boot((fresh) => [bootRegistration(fresh, options)]),
      ).rejects.toThrow(message);
    },
    HOOK_TIMEOUT_MS,
  );

  it(
    "錯綁:檢查的 repository 實際綁的是另一張表 → 建立 reader 時失敗",
    async () => {
      await expect(
        boot((fresh) => [
          bootRegistration(fresh, { injectedModel: "Customer" }),
        ]),
      ).rejects.toThrow(
        /組織歸屬檢查「boot\.items」.*model「BootItem」.*實際綁的是「Customer」\/「customers」/,
      );
    },
    HOOK_TIMEOUT_MS,
  );

  it(
    "專案 repository 不是 BaseRepository(自己包一層裸 Model)→ 啟動時失敗",
    async () => {
      class RawItemsAdapter {}
      await expect(
        boot((fresh) => [
          bootRegistration(fresh, {
            extraRepositories: () => [
              {
                provide: RawItemsAdapter,
                inject: [fresh.nestMongoose.getModelToken(MODEL)],
                useFactory: () => new RawItemsAdapter(),
              },
            ],
          }),
        ]),
      ).rejects.toThrow(/專案 repository.*BootItem.*必須是 BaseRepository/);
    },
    HOOK_TIMEOUT_MS,
  );
});
