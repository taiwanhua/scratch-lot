import {
  Module,
  type ModuleMetadata,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { MongooseModule } from "@nestjs/mongoose";

// 固定組裝入口:底座檔不得 import 專案來源,只有這裡(與 app.module.ts)例外
import { PROJECT_DATABASE_REGISTRATIONS } from "../project/database/registrations";
import { PROJECT_FORM_LIFECYCLES } from "../project/form-lifecycles";
import { PROJECT_LOOKUP_PROVIDERS } from "../project/lookup-providers";
import { PROJECT_REALTIME_BOARDS } from "../project/realtime-boards";
import {
  REALTIME_BOARDS,
  composeRealtimeBoards,
} from "../realtime/realtime-board-registration";
import {
  FORM_LIFECYCLES,
  composeFormLifecycles,
} from "../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { BASE_DATABASE_REGISTRATIONS } from "./base/registrations";
import {
  OrgBusinessDataReader,
  assertRepositoryIdentity,
  orgBusinessDataReaderProvider,
} from "./org-business-data.reader";
import { getDataScopeRuleProvider } from "./plugins/data-scope-provider";
import {
  type LookupSourceRepositoryBinding,
  PROJECT_LOOKUP_SOURCES,
  assertLookupRepositories,
} from "./project-lookup-sources";
import {
  type ComposedDatabase,
  type DatabaseRegistration,
  type LegacyUnscopedModel,
  composeDatabaseRegistrations,
} from "./registration";
import { TransactionService } from "./transaction";

// 相容出口:功能模組一直從這裡拿 repository 與文件型別,搬到 leaf 檔後照舊可用
export * from "./base/repositories";

/**
 * 專案登記的提升上下文檔案(`project/database/elevated-contexts.ts`):只經這個組裝入口轉出,
 * 給 `elevated-contexts.test.ts` 的掃描比對(底座檔不得直接 import 專案來源)。
 */
export { PROJECT_ELEVATED_CONTEXT_FILES } from "../project/database/elevated-contexts";

/**
 * 無租戶原型的精確豁免清單(docs/concepts/data-layer-and-isolation.md「底座與專案資料的組裝」):
 * 底座沒有任何例外,每張專案 model 都要掛租戶 plugin、經 BaseRepository、有組織歸屬檢查。
 * 專案登記沒有任何「略過檢查」的旗標 —— 要新增例外只能在這個底座入口逐筆列出
 * model、collection 與專用 repository,由 review 把關;列出的項目仍參與全部碰撞驗證。
 */
const LEGACY_UNSCOPED_MODELS: readonly LegacyUnscopedModel[] = [];

/** 組裝好的資料層:Nest module 的 metadata,加上啟動時要驗證的登記內容。 */
export interface DatabaseAssembly {
  readonly metadata: ModuleMetadata;
  readonly composed: ComposedDatabase;
}

/**
 * 由底座與專案的資料登記組出資料層(`DatabaseModule` 用的就是這一份):
 * - model 只在這裡向 Mongoose 註冊,**不匯出** model provider 與 MongooseModule
 * - providers / exports 全由登記導出(repository 與專用 adapter)
 * - `OrgBusinessDataReader` 的檢查清單來自登記;啟動時驗證每項檢查沒有錯綁
 * - 專案 lookup 來源(`project/lookup-providers.ts`)驗過 repository 綁定後以 `PROJECT_LOOKUP_SOURCES` 提供
 *
 * 登記不合契約(碰撞、錯綁、缺 plugin)在這裡就拋錯,app 起不來。
 */
export function assembleDatabase(
  base: readonly DatabaseRegistration[],
  project: readonly DatabaseRegistration[],
  lookupSources: readonly LookupSourceRepositoryBinding[] = [],
): DatabaseAssembly {
  const composed = composeDatabaseRegistrations(
    base,
    project,
    LEGACY_UNSCOPED_MODELS,
  );
  // 專案 lookup 來源只能綁專案資料登記的 repository(宣告本身由 LookupProvidersService 啟動時驗)
  assertLookupRepositories(lookupSources, composed);
  return {
    composed,
    metadata: {
      imports: [MongooseModule.forFeature([...composed.models])],
      providers: [
        ...composed.providers,
        orgBusinessDataReaderProvider(composed.orgDataChecks),
        TransactionService,
        { provide: PROJECT_LOOKUP_SOURCES, useValue: lookupSources },
      ],
      exports: [
        ...composed.exports,
        OrgBusinessDataReader,
        TransactionService,
        PROJECT_LOOKUP_SOURCES,
      ],
    },
  };
}

/**
 * 專案登記的 repository 必須是綁對表的 BaseRepository(既有例外除外):
 * 租戶隔離、軟刪除、資料範圍都靠它,換成別的出口就全部落空。
 */
export function assertProjectRepositories(
  moduleRef: ModuleRef,
  composed: ComposedDatabase,
): void {
  for (const binding of composed.projectRepositories) {
    assertRepositoryIdentity(
      `專案 repository(model「${binding.modelName}」)`,
      moduleRef.get<unknown>(binding.token),
      binding,
    );
  }
}

const DATABASE = assembleDatabase(
  BASE_DATABASE_REGISTRATIONS,
  PROJECT_DATABASE_REGISTRATIONS,
  PROJECT_LOOKUP_PROVIDERS,
);

/**
 * 資料層的 Nest 接線:把登記的 BaseRepository 子類、專用 adapter 與 RelationService 註冊為 provider,
 * 功能模組只注入這些出口,不直接拿 Model(ESLint `@repo/no-raw-model-query`,ADR-0005)。
 * 新 collection 不在這裡加:底座的加進 `base/registrations.ts`,專案的加進
 * `project/database/registrations.ts`。
 */
/**
 * 專案的看板頻道登記(`project/realtime-boards.ts`)也經這個組裝入口提供(STRUCT-12 api:底座只有
 * `app.module.ts` 與本檔能讀專案來源),由即時通道的 `RealtimeTicketService` 注入 `REALTIME_BOARDS`。
 */
const REALTIME_BOARD_LIST = composeRealtimeBoards(PROJECT_REALTIME_BOARDS);

/**
 * 專案的表單 / 流程掛接點(`project/form-lifecycles.ts`)同樣只經這個組裝入口提供:
 * api 與受管定義 CLI 都匯入 `DatabaseModule`,拿到同一份;(moduleKey, formKey) 重複 → 載入就拋錯。
 */
const FORM_LIFECYCLE_LIST = composeFormLifecycles(PROJECT_FORM_LIFECYCLES);

@Module({
  ...DATABASE.metadata,
  providers: [
    ...(DATABASE.metadata.providers ?? []),
    {
      provide: REALTIME_BOARDS,
      // key 重複或空白 → 載入就拋錯,app 起不來
      useValue: REALTIME_BOARD_LIST,
    },
    { provide: FORM_LIFECYCLES, useValue: FORM_LIFECYCLE_LIST },
  ],
  exports: [
    ...(DATABASE.metadata.exports ?? []),
    REALTIME_BOARDS,
    FORM_LIFECYCLES,
  ],
})
export class DatabaseModule implements OnModuleInit, OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  onModuleInit(): void {
    assertProjectRepositories(this.moduleRef, DATABASE.composed);
  }

  /**
   * **資料範圍規則的提供者必須在啟動時就註冊好**。
   *
   * 查詢中介層找不到 provider 時只套租戶保底(`plugins/tenant-scope.plugin.ts`) ——
   * 那是為了不起 Nest 的單元測試(`base.repository.test.ts`)留的路,但在**跑起來的 app**
   * 裡它等於靜默擴權:規則設了卻沒有人執行,而且不會有任何錯誤。日後把 `DataScopeModule`
   * 從 `AppModule` 拆掉、或改變 `onModuleInit` 的時機都會落進這個洞。
   *
   * 所以在此 fail-fast:`onApplicationBootstrap` 跑在所有 `onModuleInit` 之後
   * (`DataScopeService` 正是在那裡註冊),沒註冊就讓 app 起不來。
   */
  onApplicationBootstrap(): void {
    if (getDataScopeRuleProvider() === undefined) {
      throw new Error(
        "DataScopeRuleProvider 未註冊:AppModule 必須匯入 DataScopeModule,否則資料範圍規則不會被執行(ADR-0008)",
      );
    }
  }
}
