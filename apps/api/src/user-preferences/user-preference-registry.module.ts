import { type DynamicModule, Global, Module } from "@nestjs/common";

import {
  BASE_USER_PREFERENCES,
  type UserPreferenceDefinition,
  composeUserPreferences,
} from "./user-preference-registry";

/** 合成後的偏好登記(key → 定義)的 DI token。 */
export const USER_PREFERENCE_REGISTRY = Symbol("USER_PREFERENCE_REGISTRY");

/**
 * 偏好登記的組裝(STRUCT-12 api 的固定入口之一):`app.module.ts` 以
 * `forRoot(PROJECT_USER_PREFERENCES, 通知管道開關)` 把專案登記與由通知類型推導的開關接進來,
 * 與底座登記合成一份(不合契約就起不來)。全域提供,`UserPreferencesService` 與通知
 * (`NotificationService` 判斷管道開關)都注入同一份。
 */
@Global()
@Module({})
export class UserPreferenceRegistryModule {
  static forRoot(
    project: readonly UserPreferenceDefinition[],
    derived: readonly UserPreferenceDefinition[] = [],
  ): DynamicModule {
    return {
      module: UserPreferenceRegistryModule,
      providers: [
        {
          provide: USER_PREFERENCE_REGISTRY,
          useValue: composeUserPreferences(
            BASE_USER_PREFERENCES,
            project,
            derived,
          ),
        },
      ],
      exports: [USER_PREFERENCE_REGISTRY],
    };
  }
}
