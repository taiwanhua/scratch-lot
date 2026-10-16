import { describe, expect, it } from "@jest/globals";
import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { Test } from "@nestjs/testing";

import { BaseRepository } from "../database/base.repository";
import {
  FormSubmissionsRepository,
  FormVersionsRepository,
  OrgsRepository,
  UsersRepository,
} from "../database/database.module";
import { RelationService } from "../database/relation.service";
import { FormAccessService } from "./form-access.service";
import {
  LOOKUP_PROVIDER,
  type LookupProviderRegistration,
  LookupProviderRegistrationError,
  collectLookupRegistrations,
} from "./lookup-provider-registration";
import { LookupProvidersService } from "./lookup-providers";

const BASE_KEYS = ["user", "org", "form_submission"];

/** 通過 `instanceof BaseRepository` 的假 repository(不連資料庫;這裡只驗登記)。 */
const fakeRepository =
  (): LookupProviderRegistration["runtime"]["repository"] =>
    Object.create(BaseRepository.prototype) as BaseRepository<never, never>;

const registration = (
  key: string,
  overrides: Partial<LookupProviderRegistration["declaration"]> = {},
  runtime: Partial<LookupProviderRegistration["runtime"]> = {},
): LookupProviderRegistration => ({
  declaration: {
    key,
    name: "遊戲",
    fields: { name: { type: "text" }, bookAmount: { type: "number" } },
    filterFields: ["enabled"],
    labelField: "name",
    ...overrides,
  },
  runtime: { repository: fakeRepository(), ...runtime },
});

describe("collectLookupRegistrations:專案 lookup 來源的登記驗證", () => {
  it("合法的登記依 key 收集(單筆與一組都收)", () => {
    const collected = collectLookupRegistrations(
      [
        registration("lottery_game"),
        [registration("lottery_shop"), registration("lottery_prize")],
      ],
      BASE_KEYS,
    );
    expect([...collected.keys()]).toEqual([
      "lottery_game",
      "lottery_shop",
      "lottery_prize",
    ]);
  });

  it("兩個專案來源同 key → 拒絕", () => {
    expect(() =>
      collectLookupRegistrations(
        [registration("lottery_game"), registration("lottery_game")],
        BASE_KEYS,
      ),
    ).toThrow(/lookup 來源 lottery_game:重複登記/);
  });

  it("專案來源拿底座的 key → 拒絕", () => {
    expect(() =>
      collectLookupRegistrations([registration("form_submission")], BASE_KEYS),
    ).toThrow(/lookup 來源 form_submission:與底座來源撞名/);
  });

  it.each(["game", "Lottery_game", "lottery-game", "lottery_", "_game"])(
    "沒有專案前綴或格式不合的 key「%s」→ 拒絕",
    (key) => {
      expect(() =>
        collectLookupRegistrations([registration(key)], BASE_KEYS),
      ).toThrow(LookupProviderRegistrationError);
    },
  );

  it("執行面不是 BaseRepository → 拒絕(查詢一律經 BaseRepository)", () => {
    expect(() =>
      collectLookupRegistrations(
        [
          registration(
            "lottery_game",
            {},
            { repository: { modelName: "Game", collectionName: "games" } },
          ),
        ],
        BASE_KEYS,
      ),
    ).toThrow(/runtime.repository 必須是 BaseRepository/);
  });

  it("顯示欄 / 值欄 / 關鍵字欄位不在可回欄位內 → 拒絕", () => {
    expect(() =>
      collectLookupRegistrations(
        [registration("lottery_game", { labelField: "title" })],
        BASE_KEYS,
      ),
    ).toThrow(/顯示欄 title 不在可回的欄位內/);
    expect(() =>
      collectLookupRegistrations(
        [registration("lottery_game", { valueField: "code" })],
        BASE_KEYS,
      ),
    ).toThrow(/值欄 code 不在可回的欄位內/);
    expect(() =>
      collectLookupRegistrations(
        [registration("lottery_game", {}, { keywordFields: ["code"] })],
        BASE_KEYS,
      ),
    ).toThrow(/關鍵字欄位 code 不在可回的欄位內/);
  });

  it("欄位名不能是查詢運算子或巢狀路徑(`$where`、`a.b`)也不能叫 id", () => {
    for (const name of ["$where", "a.b", "id"]) {
      expect(() =>
        collectLookupRegistrations(
          [
            registration("lottery_game", {
              fields: { name: { type: "text" }, [name]: { type: "text" } },
            }),
          ],
          BASE_KEYS,
        ),
      ).toThrow(LookupProviderRegistrationError);
    }
    expect(() =>
      collectLookupRegistrations(
        [registration("lottery_game", { filterFields: ["$where"] })],
        BASE_KEYS,
      ),
    ).toThrow(/篩選欄位 \$where 不是合法的欄位名/);
  });

  it("值不是 { declaration, runtime } → 拒絕", () => {
    expect(() =>
      collectLookupRegistrations([{ key: "lottery_game" }], BASE_KEYS),
    ).toThrow(/LOOKUP_PROVIDER 的值必須是/);
  });
});

@Module({
  providers: [
    { provide: LOOKUP_PROVIDER, useValue: registration("lottery_game") },
  ],
})
class GameLookupModule {}

@Module({
  providers: [
    { provide: LOOKUP_PROVIDER, useValue: registration("lottery_game") },
  ],
})
class AnotherGameLookupModule {}

@Module({
  providers: [
    { provide: LOOKUP_PROVIDER, useValue: registration("lottery_shop") },
  ],
})
class ShopLookupModule {}

/** 只換掉 LookupProvidersService 的資料依賴(不連資料庫);收集走真的 Nest DiscoveryService。 */
async function bootstrap(modules: (new () => unknown)[]) {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule, ...modules],
    providers: [
      LookupProvidersService,
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

describe("LookupProvidersService 啟動時收集專案來源(LOOKUP_PROVIDER multi-provider)", () => {
  it("兩個模組登記同一個 key → 啟動失敗", async () => {
    await expect(
      bootstrap([GameLookupModule, AnotherGameLookupModule]),
    ).rejects.toThrow(/lookup 來源 lottery_game:重複登記/);
  });

  it("各模組的登記都收進設計器的來源清單(底座三種在前)", async () => {
    const app = await bootstrap([GameLookupModule, ShopLookupModule]);
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
