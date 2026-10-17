import { type DynamicModule, Global, Module } from "@nestjs/common";

import {
  BASE_NOTIFICATION_LINKS,
  BASE_NOTIFICATION_TYPES,
} from "./base-notification-types";
import {
  type NotificationLinkRegistration,
  type NotificationTypeDefinition,
  composeNotificationLinks,
  composeNotificationTypes,
} from "./notification-registry";

/** 合成後的通知類型(key → 定義)的 DI token。 */
export const NOTIFICATION_TYPES = Symbol("NOTIFICATION_TYPES");

/** 合成後的連結登記(refType → 登記)的 DI token。 */
export const NOTIFICATION_LINKS = Symbol("NOTIFICATION_LINKS");

/** 專案的通知登記(`src/project/notifications.ts` 的兩份清單)。 */
export interface ProjectNotificationRegistrations {
  readonly types: readonly NotificationTypeDefinition[];
  readonly links: readonly NotificationLinkRegistration[];
}

/** 底座 + 專案的通知類型(`app.module.ts` 也用它推導個人偏好的管道開關)。 */
export function composeAllNotificationTypes(
  project: ProjectNotificationRegistrations,
): ReadonlyMap<string, NotificationTypeDefinition> {
  return composeNotificationTypes(BASE_NOTIFICATION_TYPES, project.types);
}

/**
 * 通知登記的組裝(STRUCT-12 api 的固定入口之一):`app.module.ts` 以
 * `forRoot(PROJECT_NOTIFICATIONS)` 把專案的類型與連結接進來,與底座登記合成一份(不合契約就起不來)。
 * 全域提供:`NotificationService`、通知清單與通知設定都注入同一份。
 */
@Global()
@Module({})
export class NotificationRegistryModule {
  static forRoot(project: ProjectNotificationRegistrations): DynamicModule {
    return {
      module: NotificationRegistryModule,
      providers: [
        {
          provide: NOTIFICATION_TYPES,
          useValue: composeAllNotificationTypes(project),
        },
        {
          provide: NOTIFICATION_LINKS,
          useValue: composeNotificationLinks(
            BASE_NOTIFICATION_LINKS,
            project.links,
          ),
        },
      ],
      exports: [NOTIFICATION_TYPES, NOTIFICATION_LINKS],
    };
  }
}
