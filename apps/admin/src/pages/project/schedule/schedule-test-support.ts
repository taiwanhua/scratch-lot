import { HttpResponse } from "msw";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import { tenantTree } from "@/test/msw/org-fixtures";
import {
  type ScheduleAttendanceWorldOptions,
  scheduleAttendanceWorld,
} from "@/test/msw/project/schedule-attendance-handlers";
import {
  type ScheduleCalendarWorldOptions,
  scheduleCalendarWorld,
} from "@/test/msw/project/schedule-calendar-handlers";
import {
  type ScheduleDayOffsWorldOptions,
  scheduleDayOffsWorld,
} from "@/test/msw/project/schedule-day-offs-handlers";
import { scheduleModules } from "@/test/msw/project/schedule-module-fixtures";
import {
  type ScheduleMyWorldOptions,
  scheduleMyWorld,
} from "@/test/msw/project/schedule-my-handlers";
import {
  type ScheduleRosterWorldOptions,
  scheduleRosterWorld,
} from "@/test/msw/project/schedule-roster-handlers";
import { SCHEDULE_BRANCH } from "@/test/msw/project/schedule-settings-fixtures";
import {
  type ScheduleSettingsWorldOptions,
  scheduleSettingsWorld,
} from "@/test/msw/project/schedule-settings-handlers";
import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import { applyCenterModules } from "@/test/msw/workflow-fixtures";
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
  roster?: ScheduleRosterWorldOptions;
  /** 我的班表 → 班表分頁 */
  my?: ScheduleMyWorldOptions;
  /** 出勤紀錄(依人員 / 依分店、改對應排班、補打卡的下拉) */
  attendance?: ScheduleAttendanceWorldOptions;
}

/**
 * 班表管理頁的測試場景:路由、殼、守門都是真的,只有 api 是假的
 * (`scheduleSettingsWorld` / `scheduleCalendarWorld` / `scheduleDayOffsWorld` / `scheduleMyWorld`;表單與流程用底座的 world;分店選擇器的組織樹用租戶 A 的樹)。
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
  roster = {},
  my = {},
  attendance = {},
}: RenderScheduleOptions) => {
  const settingsFake = scheduleSettingsWorld(settings);
  const calendarFake = scheduleCalendarWorld(calendar);
  const dayOffsFake = scheduleDayOffsWorld(dayOffs);
  const formsFake = formRuntimeWorld(forms);
  const workflowFake = workflowRuntimeWorld(workflow);
  const rosterFake = scheduleRosterWorld(roster);
  const myFake = scheduleMyWorld(my);
  const attendanceFake = scheduleAttendanceWorld(attendance);
  server.use(
    ...attendanceFake.handlers,
    ...rosterFake.handlers,
    ...myFake.handlers,
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
      // 申請中心(詳情頁的審核區塊:模組登記的審核畫面擴充)
      modules: [...scheduleModules(omit), ...applyCenterModules()],
    }).handlers,
  );
  return {
    ...renderApp({ path }),
    settingsFake,
    calendarFake,
    dayOffsFake,
    formsFake,
    workflowFake,
    rosterFake,
    myFake,
    attendanceFake,
  };
};
