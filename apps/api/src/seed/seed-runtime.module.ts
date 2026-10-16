/* eslint-disable no-restricted-imports -- CLI 的組裝入口:與 app.module.ts 一樣要用 MongooseModule 建立連線(forRootAsync),並以同一條連線等索引建好;不註冊也不注入任何 model;到期條件:無 */
import { Module, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { InjectConnection, MongooseModule } from "@nestjs/mongoose";
import type { Connection } from "mongoose";

import { AudienceCoreModule } from "../audience/audience-core.module";
import { AuditModule } from "../audit/audit.module";
import { DataScopeService } from "../data-scope/data-scope.service";
import { DatabaseModule } from "../database/database.module";
import { MONGODB_URI_ENV, requireMongoDbUri } from "../database/mongodb-uri";
import { FormDesignModule } from "../forms/form-design/form-design.module";
import { FormsCoreModule } from "../forms/forms-core.module";
import { PermissionModule } from "../permission/permission.module";
import { WorkflowDesignModule } from "../workflows/workflow-design/workflow-design.module";
import { DefinitionSeedModule } from "./definition-seed.module";

/** 連線字串的環境變數;CLI 與啟動它的命令必須是同一個資料庫,所以沒有預設值(檢查見 `database/mongodb-uri.ts`)。 */
export { MONGODB_URI_ENV } from "../database/mongodb-uri";

/**
 * 受管定義 CLI(`seed/run.ts`)的最小 Nest 組裝:Mongoose 連線、資料層、權限解析、稽核、
 * 表單與流程的設計服務,加上安裝本身。**不是** `AppModule` 的子集合再關掉幾樣 —— 這裡從頭就沒有
 * GraphQL / HTTP、登入線、檔案儲存、寄信與流程引擎,所以不會開埠、不會寄信、也沒有背景工作。
 *
 * 資料範圍照常生效:`DataScopeService` 以既有的 class 註冊,啟動時把自己登記成查詢中介層的規則提供者;
 * `DatabaseModule` 的啟動檢查(沒有規則提供者就起不來)原樣保留。不匯入 `DataScopeModule` 是因為它帶著
 * `OrgsModule`,會連登入線與檔案儲存一起啟動;它需要的 `OwnerProtectionService` 由 `DefinitionSeedModule` 匯出、`AudienceService`(套用對象的判斷)由 `AudienceCoreModule` 匯出。
 *
 * 設定只讀程序的環境變數(`ignoreEnvFile`):連到哪個資料庫、用哪個帳號由啟動它的命令決定,
 * 不被工作目錄裡的 `.env` 換掉。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: requireMongoDbUri(config.get<string>(MONGODB_URI_ENV)),
      }),
    }),
    DatabaseModule,
    PermissionModule,
    AudienceCoreModule,
    AuditModule,
    FormsCoreModule,
    FormDesignModule,
    WorkflowDesignModule,
    DefinitionSeedModule,
  ],
  providers: [DataScopeService],
})
export class SeedRuntimeModule implements OnApplicationBootstrap {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * 等每張表的索引建好才開始安裝。安裝沒有交易,「同一張表單至多一份草稿」「一份宣告只有一筆安裝紀錄」
   * 「版號不重複」都靠唯一索引;全新或剛重建的資料庫上,CLI 可能是第一個連進來的 api 程序,
   * Mongoose 在背景建索引的這段時間不能先寫入。
   */
  async onApplicationBootstrap(): Promise<void> {
    await Promise.all(
      Object.values(this.connection.models).map((model) => model.init()),
    );
  }
}
