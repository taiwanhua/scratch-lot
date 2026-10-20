import { HttpResponse } from "msw";

import { authWorld } from "@/test/msw/auth-handlers";
import { tenantTree } from "@/test/msw/org-fixtures";
import {
  type ScheduleCalendarWorldOptions,
  scheduleCalendarWorld,
} from "@/test/msw/project/schedule-calendar-handlers";
import { scheduleModules } from "@/test/msw/project/schedule-module-fixtures";
import { SCHEDULE_BRANCH } from "@/test/msw/project/schedule-settings-fixtures";
import {
  type ScheduleSettingsWorldOptions,
  scheduleSettingsWorld,
} from "@/test/msw/project/schedule-settings-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

export interface RenderScheduleOptions {
  path: string;
  /** 拿掉的權限 key(其餘給滿) */
  omit?: readonly string[];
  settings?: ScheduleSettingsWorldOptions;
  calendar?: ScheduleCalendarWorldOptions;
}

/**
 * 班表管理頁的測試場景:路由、殼、守門都是真的,只有 api 是假的
 * (`scheduleSettingsWorld` / `scheduleCalendarWorld`;分店選擇器的組織樹用租戶 A 的樹)。
 * 當前組織 = A-2 台北分店。
 */
export const renderSchedulePage = ({
  path,
  omit = [],
  settings = {},
  calendar = {},
}: RenderScheduleOptions) => {
  const settingsFake = scheduleSettingsWorld(settings);
  const calendarFake = scheduleCalendarWorld(calendar);
  server.use(
    ...settingsFake.handlers,
    ...calendarFake.handlers,
    api.query("OrgTree", () =>
      HttpResponse.json({ data: { orgTree: tenantTree } }),
    ),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [{ id: SCHEDULE_BRANCH.id, name: SCHEDULE_BRANCH.name }],
      modules: scheduleModules(omit),
    }).handlers,
  );
  return { ...renderApp({ path }), settingsFake, calendarFake };
};
