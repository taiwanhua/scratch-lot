import {
  type NotificationSettingsWorldOptions,
  notificationPermissionModules,
  notificationTypes,
} from "@/test/msw/notification-settings-handlers";
import { matrixModules } from "@/test/msw/role-fixtures";
import { HR_ROLE_ID } from "@/test/msw/workflow-audience-fixtures";

/**
 * mock 模式的通知設定(底座規格第 5 章):印表機離線調整過收件人(角色「人資」且持有印表機管理 · 編輯)、
 * 盤點提醒用預設。權限候選樹 = 示範家族 + 印表機管理 / 通知設定,預設收件人的權限名稱才解得出來。
 */
export const mockNotificationSettings =
  (): NotificationSettingsWorldOptions => ({
    types: notificationTypes({
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
    permissionModules: [...matrixModules, ...notificationPermissionModules],
  });
