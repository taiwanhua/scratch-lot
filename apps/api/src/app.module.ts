import path from "node:path";

import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { ApolloDriver, type ApolloDriverConfig } from "@nestjs/apollo";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { GraphQLModule } from "@nestjs/graphql";
import { MongooseModule } from "@nestjs/mongoose";

import type { GraphqlContext } from "./auth/request-context";
import { composeApiFeatures } from "./base/api-feature-registration";
import { BASE_API_MODULES } from "./base/api-modules";
import { MONGODB_URI_ENV, requireMongoDbUri } from "./database/mongodb-uri";
import { PROJECT_API_MODULES } from "./project/api-modules";
import { ProjectModule } from "./project/project.module";
import { PROJECT_USER_PREFERENCES } from "./project/user-preferences";
import { UserPreferenceRegistryModule } from "./user-preferences/user-preference-registry.module";

// 功能組裝的固定入口:底座清單與專案清單分開維護,這裡先驗兩份的 key 與 module 都不重複。
// 底座功能直接匯入;專案功能由普通的 ProjectModule 匯入(只新增,不替換核心 module / provider)。
const BASE_FEATURE_MODULES = composeApiFeatures(
  BASE_API_MODULES,
  PROJECT_API_MODULES,
);

// GraphQL Sandbox 開關:本地開發(NODE_ENV 非 production)預設開;
// 雲端預設關(不讓外人窺探 schema),dev/staging 環境以 GRAPHQL_SANDBOX=true 明確打開
const isSandboxEnabled =
  process.env.GRAPHQL_SANDBOX === "true" ||
  process.env.NODE_ENV !== "production";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: requireMongoDbUri(config.get<string>(MONGODB_URI_ENV)),
      }),
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // 測試(NODE_ENV=test)用記憶體 schema:測試專用 module(如權限探針)不得寫進提交的 schema.gql 產物(GQL-05)
      autoSchemaFile:
        process.env.NODE_ENV === "test"
          ? true
          : path.join(process.cwd(), "schema.gql"),
      sortSchema: true,
      introspection: isSandboxEnabled,
      playground: false,
      // 登入守門讀 Authorization 標頭、refresh cookie 讀寫都要拿到 Express 的 req / res
      context: ({ req, res }: GraphqlContext): GraphqlContext => ({ req, res }),
      plugins: isSandboxEnabled
        ? [ApolloServerPluginLandingPageLocalDefault({ embed: true })]
        : [],
    }),
    // 個人偏好的登記:底座 + 專案(`project/user-preferences.ts`)合成一份,全域提供
    UserPreferenceRegistryModule.forRoot(PROJECT_USER_PREFERENCES),
    ...BASE_FEATURE_MODULES,
    ProjectModule,
  ],
})
export class AppModule {}
