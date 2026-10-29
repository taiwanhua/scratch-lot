import { HttpResponse } from "msw";

import type {
  MarkNotificationsReadMutationVariables,
  MyNotificationsQuery,
  MyNotificationsQueryVariables,
} from "@repo/graphql";

import { api } from "./server";

export type TestNotification =
  MyNotificationsQuery["myNotifications"]["items"][number];

/** 一種通知類型的管道(`canDisable = false` = 開關停用;api `base-notification-types.ts`)。 */
export interface TestNotificationType {
  type: string;
  name: string;
  channels: { channel: string; canDisable: boolean }[];
}

/** 偏好 key(正本 api `notification-registry.ts` 的 `notificationPreferenceKey`)。 */
export const notificationPreferenceKey = (type: string, channel: string) =>
  `notification_${type.replaceAll(".", "_")}_${channel}`;

/**
 * 底座登記的類型(api `base-notification-types.ts`;`workflow.task-created` 的站內不能關)。
 * 夾具只取個人偏好分頁用得到的欄位。
 */
export const baseNotificationTypes: TestNotificationType[] = [
  {
    type: "workflow.task-created",
    name: "待你審核",
    channels: [
      { channel: "in-app", canDisable: false },
      { channel: "email", canDisable: true },
    ],
  },
  {
    type: "workflow.result",
    name: "申請結果",
    channels: [
      { channel: "in-app", canDisable: true },
      { channel: "email", canDisable: true },
    ],
  },
  {
    type: "workflow.overdue",
    name: "審核逾時",
    channels: [
      { channel: "in-app", canDisable: true },
      { channel: "email", canDisable: true },
    ],
  },
  {
    type: "workflow.cc",
    name: "知會",
    channels: [{ channel: "in-app", canDisable: true }],
  },
  {
    type: "printing.job-failed",
    name: "列印失敗",
    channels: [{ channel: "in-app", canDisable: true }],
  },
  {
    type: "printing.agent-offline",
    name: "列印代理程式離線",
    channels: [{ channel: "in-app", canDisable: true }],
  },
];

/**
 * 交給 `authWorld({ preferences })` 的偏好初值:每個類型 × 管道一個 key、預設開。
 * `authWorld` 的 `UpdateMyPreferences` 只收已有的 key(同 api 的登記制),所以通知開關要先放進去。
 */
export const notificationPreferenceDefaults = (
  types: readonly TestNotificationType[] = baseNotificationTypes,
): Record<string, unknown> =>
  Object.fromEntries(
    types.flatMap((entry) =>
      entry.channels.map((channel) => [
        notificationPreferenceKey(entry.type, channel.channel),
        true,
      ]),
    ),
  );

const now = () => new Date().toISOString();

let sequence = 0;

/** 一則通知;`readAt: null` = 未讀。 */
export const notificationFixture = (
  overrides: Partial<TestNotification> = {},
): TestNotification => {
  sequence += 1;
  return {
    id: `n-${String(sequence)}`,
    type: "workflow.task-created",
    title: `待你審核:示範表單 #F-${String(sequence).padStart(4, "0")}`,
    body: "王小明 送出示範表單,共 5 筆明細。",
    refType: "workflow-instance",
    refId: `inst-${String(sequence)}`,
    link: `/apply-center/view-page/inst-${String(sequence)}`,
    readAt: null,
    createdAt: "2026-10-17T02:00:00.000Z",
    ...overrides,
  };
};

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

/** mock 開發模式的通知(照 Figma 的三則:兩則未讀、一則已讀)。 */
export const sampleNotifications = (): TestNotification[] => [
  notificationFixture({
    id: "mock-n-1",
    title: "待你審核:示範表單 #F-0012",
    body: "王小明 送出示範表單,共 5 筆明細。",
    refId: "inst-1",
    link: "/apply-center/view-page/inst-1",
    createdAt: minutesAgo(10),
  }),
  notificationFixture({
    id: "mock-n-2",
    type: "workflow.overdue",
    title: "審核逾時:病假單",
    body: "病假三天 已超過 24 小時未處理。",
    refId: "inst-2",
    link: "/apply-center/view-page/inst-2",
    createdAt: minutesAgo(60),
  }),
  notificationFixture({
    id: "mock-n-3",
    type: "printing.job-failed",
    title: "列印失敗:缺紙",
    body: "收據 #P-0031 未印出,請補紙後補印。",
    refType: null,
    refId: null,
    link: null,
    readAt: minutesAgo(600),
    createdAt: minutesAgo(900),
  }),
];

export interface NotificationWorldOptions {
  /** 由新到舊 */
  notifications?: TestNotification[];
  types?: TestNotificationType[];
  /** 帳號偏好(傳 `authWorld(...).preferences` 讓偏好分頁讀到寫入後的值) */
  preferences?: Record<string, unknown>;
}

/**
 * 「我的通知」的假 api(有狀態;形狀對照 api `notifications.test.ts`):
 * - MyNotifications:依陣列順序(新到舊)以游標分頁(同 api:游標記「上一批最後一則」的位置,
 *   `after` 之後接著列;夾具的游標是那一則的 id),`unreadOnly` 只列未讀
 * - MyNotificationUnreadCount / MarkNotificationsRead / MarkAllNotificationsRead:改陣列裡的 `readAt`,回動作後的未讀數
 * - MyNotificationPreferences:類型 × 管道,`enabled` 讀 `preferences`(沒有 = 開)
 *
 * `arrive()` 模擬「新通知寫入」(插到最前面);信號由測試自己的假 WebSocket 送。
 */
export const notificationWorld = (options: NotificationWorldOptions = {}) => {
  const notifications = [...(options.notifications ?? [])];
  const types = options.types ?? baseNotificationTypes;
  const preferences = options.preferences ?? {};
  const calls = {
    list: [] as { unreadOnly: boolean; after: string | null }[],
  };
  const markedRead: string[] = [];

  const unreadCount = () =>
    notifications.filter((item) => item.readAt === null).length;

  const handlers = [
    api.query("MyNotifications", ({ variables }) => {
      const { input } = variables as MyNotificationsQueryVariables;
      const unreadOnly = input.unreadOnly === true;
      const after = input.after ?? null;
      const pageSize = input.pageSize ?? 20;
      calls.list.push({ unreadOnly, after });
      const matches = (item: TestNotification) =>
        !unreadOnly || item.readAt === null;
      // 游標是位置:從全部通知裡那一則的下一則開始(那一則已讀、離開「未讀」篩選也照樣定位)
      const start =
        after === null
          ? 0
          : notifications.findIndex((item) => item.id === after) + 1;
      const rest = notifications.slice(start).filter((item) => matches(item));
      const items = rest.slice(0, pageSize);
      return HttpResponse.json({
        data: {
          myNotifications: {
            items,
            pageSize,
            nextCursor:
              rest.length > pageSize ? (items.at(-1)?.id ?? null) : null,
            totalCount: notifications.filter((item) => matches(item)).length,
            unreadCount: unreadCount(),
          },
        },
      });
    }),
    api.query("MyNotificationUnreadCount", () =>
      HttpResponse.json({
        data: { myNotificationUnreadCount: { count: unreadCount() } },
      }),
    ),
    api.mutation("MarkNotificationsRead", ({ variables }) => {
      const { ids } = (variables as MarkNotificationsReadMutationVariables)
        .input;
      for (const item of notifications) {
        if (ids.includes(item.id) && item.readAt === null) {
          item.readAt = now();
          markedRead.push(item.id);
        }
      }
      return HttpResponse.json({
        data: { markNotificationsRead: { unreadCount: unreadCount() } },
      });
    }),
    api.mutation("MarkAllNotificationsRead", () => {
      for (const item of notifications) {
        if (item.readAt === null) {
          item.readAt = now();
          markedRead.push(item.id);
        }
      }
      return HttpResponse.json({
        data: { markAllNotificationsRead: { unreadCount: 0 } },
      });
    }),
    api.query("MyNotificationPreferences", () =>
      HttpResponse.json({
        data: {
          myNotificationPreferences: {
            items: types.map((entry) => ({
              type: entry.type,
              name: entry.name,
              channels: entry.channels.map((channel) => {
                const preferenceKey = notificationPreferenceKey(
                  entry.type,
                  channel.channel,
                );
                return {
                  channel: channel.channel,
                  preferenceKey,
                  enabled: preferences[preferenceKey] !== false,
                  canDisable: channel.canDisable,
                };
              }),
            })),
          },
        },
      }),
    ),
  ];

  return {
    handlers,
    calls,
    notifications,
    markedRead,
    /** 新通知寫入(依參數順序,最後一個是最新的,插到最前面) */
    arrive: (...arrived: TestNotification[]) => {
      notifications.unshift(...arrived.toReversed());
    },
  };
};
