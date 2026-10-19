import { NotificationScheduleKind } from "@repo/graphql";

import {
  type NotificationSettingsWorldOptions,
  monthlyType,
  notificationPermissionModules,
  notificationTypes,
  partyScheduledType,
  systemModule,
} from "@/test/msw/notification-settings-handlers";
import { matrixModules } from "@/test/msw/role-fixtures";
import { HR_ROLE_ID } from "@/test/msw/workflow-audience-fixtures";

/**
 * 流程管理與它的阻擋清單隱藏頁(seed `system.ts`):流程設計器逾時提醒的預設通知對象
 * (`DEFAULT_OVERDUE_AUDIENCE` = 持有 `system.workflows.blocked-page.reassign`)才解得出權限名稱。
 */
const workflowsModule = {
  ...systemModule("system.workflows", "流程管理", [["view", "檢視"]]),
  children: [
    {
      ...systemModule("system.workflows.blocked-page", "阻擋清單", [
        ["reassign", "改派與重試推進"],
      ]),
      parentId: "m-system.workflows",
    },
  ],
};

/**
 * mock 模式的通知設定:印表機離線調整過收件人(角色「人資」且持有印表機管理 · 編輯、沒有提醒時間)、
 * 到期提醒的提醒時間調整成 60 / 7 / 0 天、月報提醒(每月第 N 天)用預設、截止提醒是宣告了提醒時間的當事人通知。權限候選樹 = 示範家族 + 印表機管理 / 通知設定 / 流程管理(含阻擋清單),預設收件人的權限名稱才解得出來。
 */
export const mockNotificationSettings =
  (): NotificationSettingsWorldOptions => ({
    types: [
      ...notificationTypes({
        "demo.expiry-reminder": {
          schedule: {
            kind: NotificationScheduleKind.DaysBefore,
            daysBefore: [60, 7, 0],
            time: "09:00",
          },
        },
        "printing.agent-offline": {
          audience: {
            mode: "match",
            filter: {
              op: "AND",
              children: [
                {
                  field: "role",
                  cond: "in",
                  value: { kind: "static", values: [HR_ROLE_ID] },
                },
                {
                  field: "permission",
                  cond: "in",
                  value: { kind: "static", values: ["system.printers.edit"] },
                },
              ],
            },
          },
        },
      }),
      monthlyType(),
      partyScheduledType(),
    ],
    permissionModules: [
      ...matrixModules,
      ...notificationPermissionModules.map((module) =>
        module.key === "system"
          ? { ...module, children: [...module.children, workflowsModule] }
          : module,
      ),
    ],
  });
