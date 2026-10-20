import { HttpResponse } from "msw";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import { tenantTree } from "@/test/msw/org-fixtures";
import {
  type ScheduleCalendarWorldOptions,
  scheduleCalendarWorld,
} from "@/test/msw/project/schedule-calendar-handlers";
import {
  type ScheduleDayOffsWorldOptions,
  scheduleDayOffsWorld,
} from "@/test/msw/project/schedule-day-offs-handlers";
import { scheduleModules } from "@/test/msw/project/schedule-module-fixtures";
import { SCHEDULE_BRANCH } from "@/test/msw/project/schedule-settings-fixtures";
import {
  type ScheduleSettingsWorldOptions,
  scheduleSettingsWorld,
} from "@/test/msw/project/schedule-settings-handlers";
import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import {
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";
import { renderApp } from "@/test/render";

export interface RenderScheduleOptions {
  path: string;
  /** 拿掉的權限 key(其餘給滿) */
  omit?: readonly string[];
  settings?: ScheduleSettingsWorldOptions;
  calendar?: ScheduleCalendarWorldOptions;
  dayOffs?: ScheduleDayOffsWorldOptions;
  /** 表單執行端(支援需求單的列表、詳情、新增頁) */
  forms?: FormRuntimeWorldOptions;
  /** 審核流程(支援需求單右側的審核區塊) */
  workflow?: WorkflowRuntimeWorldOptions;
}

/**
 * 班表管理頁的測試場景:路由、殼、守門都是真的,只有 api 是假的
 * (`scheduleSettingsWorld` / `scheduleCalendarWorld` / `scheduleDayOffsWorld`;表單與流程用底座的 world;分店選擇器的組織樹用租戶 A 的樹)。
 * 當前組織 = A-2 台北分店。
 */
export const renderSchedulePage = ({
  path,
  omit = [],
  settings = {},
  calendar = {},
  dayOffs = {},
  forms = {},
  workflow = {},
}: RenderScheduleOptions) => {
  const settingsFake = scheduleSettingsWorld(settings);
  const calendarFake = scheduleCalendarWorld(calendar);
  const dayOffsFake = scheduleDayOffsWorld(dayOffs);
  const formsFake = formRuntimeWorld(forms);
  const workflowFake = workflowRuntimeWorld(workflow);
  server.use(
    ...settingsFake.handlers,
    ...calendarFake.handlers,
    ...dayOffsFake.handlers,
    ...formsFake.handlers,
    ...workflowFake.handlers,
    // 分店選擇器(visible 模式)查整棵租戶樹;當前組織 A-2 台北分店與租戶 A 都看得到
    api.query("TenantOrgTree", () =>
      HttpResponse.json({
        data: {
          tenantOrgTree: toTenantTree(tenantTree, {
            visibleIds: ["org-tenant-a", "org-store", "org-content"],
          }),
        },
      }),
    ),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [{ id: SCHEDULE_BRANCH.id, name: SCHEDULE_BRANCH.name }],
      modules: scheduleModules(omit),
    }).handlers,
  );
  return {
    ...renderApp({ path }),
    settingsFake,
    calendarFake,
    dayOffsFake,
    formsFake,
    workflowFake,
  };
};
