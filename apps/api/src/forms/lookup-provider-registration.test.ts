import { describe, expect, it } from "@jest/globals";
import { Test } from "@nestjs/testing";

import { BaseRepository } from "../database/base.repository";
import { BASE_DATABASE_REGISTRATIONS } from "../database/base/registrations";
import {
  FormSubmissionsRepository,
  FormVersionsRepository,
  OrgsRepository,
  UsersRepository,
} from "../database/database.module";
import {
  PROJECT_LOOKUP_SOURCES,
  assertLookupRepositories,
} from "../database/project-lookup-sources";
import { composeDatabaseRegistrations } from "../database/registration";
import { RelationService } from "../database/relation.service";
import { PROJECT_FIXTURE_DATABASE_REGISTRATIONS } from "../test-support/project-fixture/database/registrations";
import { PROJECT_FIXTURE_LOOKUP_PROVIDERS } from "../test-support/project-fixture/project-fixture-lookup";
import { FormAccessService } from "./form-access.service";
import {
  type LookupProviderRegistration,
  LookupProviderRegistrationError,
  type ProjectLookupDeclaration,
  resolveLookupRegistrations,
} from "./lookup-provider-registration";
import { LookupProvidersService } from "./lookup-providers";

const BASE_KEYS = ["user", "org", "form_submission"];

/** 通過 `instanceof BaseRepository`、綁某張表的假 repository(不連資料庫;這裡只驗登記)。 */
function fakeRepository(collectionName: string): unknown {
  const repository = Object.create(BaseRepository.prototype) as object;
  Object.defineProperty(repository, "model", {
    value: { collection: { collectionName }, modelName: collectionName },
  });
  return repository;
}

class GamesRepository {}
class ShopsRepository {}

const REPOSITORIES = new Map<typeof GamesRepository, unknown>([
  [GamesRepository, fakeRepository("lottery_games")],
  [ShopsRepository, fakeRepository("lottery_shops")],
]);

const registration = (
  key: string,
  overrides: Partial<ProjectLookupDeclaration> = {},
  repositoryToken: LookupProviderRegistration["repositoryToken"] = GamesRepository,
): LookupProviderRegistration => ({
  declaration: {
    key,
    name: "遊戲",
    permission: null,
    fields: {
      name: { type: "text" },
      code: { type: "text" },
      bookAmount: { type: "number" },
    },
    filterFields: ["enabled"],
    labelField: "name",
    ...overrides,
  },
  repositoryToken,
});

const resolve = (registrations: LookupProviderRegistration[]) =>
  resolveLookupRegistrations(registrations, BASE_KEYS, (token) =>
    REPOSITORIES.get(token as typeof GamesRepository),
  );

describe("resolveLookupRegistrations:專案 lookup 來源的登記驗證", () => {
  it("合法的登記依 key 收集", () => {
    const resolved = resolve([
      registration("lottery_game"),
      registration("lottery_shop", {}, ShopsRepository),
    ]);
    expect([...resolved.keys()]).toEqual(["lottery_game", "lottery_shop"]);
  });

  it("同 key 登記兩次 → 拒絕", () => {
    expect(() =>
      resolve([registration("lottery_game"), registration("lottery_game")]),
    ).toThrow(/lookup 來源 lottery_game:重複登記/);
  });

  it("專案來源拿底座的 key → 拒絕", () => {
    expect(() => resolve([registration("form_submission")])).toThrow(
      /lookup 來源 form_submission:與底座來源撞名/,
    );
  });

  it.each(["game", "Lottery_game", "lottery-game", "lottery_", "_game"])(
    "沒有專案前綴或格式不合的 key「%s」→ 拒絕",
    (key) => {
      expect(() => resolve([registration(key)])).toThrow(
        LookupProviderRegistrationError,
      );
    },
  );

  it("key 的前綴與資料表名第一段不同 → 拒絕(lottery_games 只能登記 lottery_…)", () => {
    expect(() => resolve([registration("shop_game")])).toThrow(
      /key 的前綴必須與資料表 lottery_games 的第一段相同/,
    );
  });

  it("repositoryToken 指到的不是 BaseRepository → 拒絕", () => {
    expect(() =>
      resolveLookupRegistrations(
        [registration("lottery_game")],
        BASE_KEYS,
        () => ({ collectionName: "lottery_games" }),
      ),
    ).toThrow(/repositoryToken 必須指向 BaseRepository/);
  });

  it("permission 必須是權限 key 或 null", () => {
    expect(() =>
      resolve([
        registration("lottery_game", {
          permission: undefined as unknown as null,
        }),
      ]),
    ).toThrow(/permission 必須是權限 key 或 null/);
    expect(() =>
      resolve([registration("lottery_game", { permission: " " })]),
    ).toThrow(/permission 必須是權限 key 或 null/);
  });

  it("顯示欄 / 值欄 / 關鍵字欄位不在可回欄位內 → 拒絕;值欄非 id 時只能是文字欄位", () => {
    expect(() =>
      resolve([registration("lottery_game", { labelField: "title" })]),
    ).toThrow(/顯示欄 title 不在可回的欄位內/);
    expect(() =>
      resolve([registration("lottery_game", { valueField: "serial" })]),
    ).toThrow(/值欄 serial 不在可回的欄位內/);
    expect(() =>
      resolve([registration("lottery_game", { keywordFields: ["serial"] })]),
    ).toThrow(/關鍵字欄位 serial 不在可回的欄位內/);
    expect(() =>
      resolve([registration("lottery_game", { valueField: "bookAmount" })]),
    ).toThrow(/值欄 bookAmount 必須是 id 或文字欄位/);
    expect(
      resolve([registration("lottery_game", { valueField: "code" })]).size,
    ).toBe(1);
  });

  it("欄位名不能是查詢運算子或巢狀路徑(`$where`、`a.b`)也不能叫 id", () => {
    for (const name of ["$where", "a.b", "id"]) {
      expect(() =>
        resolve([
          registration("lottery_game", {
            fields: { name: { type: "text" }, [name]: { type: "text" } },
          }),
        ]),
      ).toThrow(LookupProviderRegistrationError);
    }
    expect(() =>
      resolve([registration("lottery_game", { filterFields: ["$where"] })]),
    ).toThrow(/篩選欄位 \$where 不是合法的欄位名/);
  });
});

describe("assertLookupRepositories:只能綁專案資料登記的 repository", () => {
  const composed = composeDatabaseRegistrations(
    BASE_DATABASE_REGISTRATIONS,
    PROJECT_FIXTURE_DATABASE_REGISTRATIONS,
  );

  it("專案資料登記的 repository → 通過", () => {
    expect(() => {
      assertLookupRepositories(PROJECT_FIXTURE_LOOKUP_PROVIDERS, composed);
    }).not.toThrow();
  });

  it("拿底座的 repository(UsersRepository)登記 → 組裝失敗(app 起不來)", () => {
    expect(() => {
      assertLookupRepositories(
        [registration("users_account", {}, UsersRepository)],
        composed,
      );
    }).toThrow(
      /lookup 來源 users_account:repository UsersRepository 不是專案資料登記的 repository/,
    );
  });
});

/** 只換掉 LookupProvidersService 的資料依賴(不連資料庫);清單與 repository 走真的 Nest 注入。 */
async function bootstrap(registrations: LookupProviderRegistration[]) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      LookupProvidersService,
      { provide: PROJECT_LOOKUP_SOURCES, useValue: registrations },
      ...[...REPOSITORIES].map(([token, value]) => ({
        provide: token,
        useValue: value,
      })),
      ...[
        UsersRepository,
        OrgsRepository,
        RelationService,
        FormSubmissionsRepository,
        FormVersionsRepository,
        FormAccessService,
      ].map((token) => ({ provide: token, useValue: {} })),
    ],
  }).compile();
  return moduleRef.init();
}

describe("LookupProvidersService 啟動時解析專案來源", () => {
  it("同一個 key 登記兩次 → 啟動失敗", async () => {
    await expect(
      bootstrap([registration("lottery_game"), registration("lottery_game")]),
    ).rejects.toThrow(/lookup 來源 lottery_game:重複登記/);
  });

  it("清單裡的來源都進設計器的來源清單(底座三種在前)", async () => {
    const app = await bootstrap([
      registration("lottery_shop", {}, ShopsRepository),
      registration("lottery_game"),
    ]);
    const keys = app
      .get(LookupProvidersService)
      .summaries()
      .map((summary) => summary.key);
    expect(keys).toEqual([
      "user",
      "org",
      "form_submission",
      "lottery_game",
      "lottery_shop",
    ]);
    await app.close();
  });
});
