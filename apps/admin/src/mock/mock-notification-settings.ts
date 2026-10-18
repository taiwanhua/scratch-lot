import {
  type NotificationSettingsWorldOptions,
  notificationPermissionModules,
  notificationTypes,
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
 * mock 模式的通知設定:印表機離線調整過收件人(角色「人資」且持有印表機管理 · 編輯)、
 * 到期提醒用預設。權限候選樹 = 示範家族 + 印表機管理 / 通知設定 / 流程管理(含阻擋清單),預設收件人的權限名稱才解得出來。
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
    permissionModules: [
      ...matrixModules,
      ...notificationPermissionModules.map((module) =>
        module.key === "system"
          ? { ...module, children: [...module.children, workflowsModule] }
          : module,
      ),
    ],
  });
