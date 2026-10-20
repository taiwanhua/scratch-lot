import { HttpResponse } from "msw";

import { authWorld } from "@/test/msw/auth-handlers";
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
import { renderApp } from "@/test/render";

export interface RenderScheduleOptions {
  path: string;
  /** 拿掉的權限 key(其餘給滿) */
  omit?: readonly string[];
  settings?: ScheduleSettingsWorldOptions;
  calendar?: ScheduleCalendarWorldOptions;
  dayOffs?: ScheduleDayOffsWorldOptions;
}

/**
 * 班表管理頁的測試場景:路由、殼、守門都是真的,只有 api 是假的
 * (`scheduleSettingsWorld` / `scheduleCalendarWorld` / `scheduleDayOffsWorld`;分店選擇器的組織樹用租戶 A 的樹)。
 * 當前組織 = A-2 台北分店。
 */
export const renderSchedulePage = ({
  path,
  omit = [],
  settings = {},
  calendar = {},
  dayOffs = {},
}: RenderScheduleOptions) => {
  const settingsFake = scheduleSettingsWorld(settings);
  const calendarFake = scheduleCalendarWorld(calendar);
  const dayOffsFake = scheduleDayOffsWorld(dayOffs);
  server.use(
    ...settingsFake.handlers,
    ...calendarFake.handlers,
    ...dayOffsFake.handlers,
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
  return { ...renderApp({ path }), settingsFake, calendarFake, dayOffsFake };
};
