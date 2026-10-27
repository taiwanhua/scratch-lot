import {
  SCHEDULE_ATTENDANCE_KEY,
  SCHEDULE_GROUP_KEY,
  SCHEDULE_MANAGE_KEY,
  SCHEDULE_MY_KEY,
  SCHEDULE_SETTINGS_KEY,
} from "../../schedule";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 表單模組的三個隱藏頁(詳情 / 新增 / 編輯)。 */
function formPages(moduleKey: string): string[] {
  return ["view-page", "create-page", "edit-page"].map(
    (page) => `${moduleKey}.${page}`,
  );
}

function permissionsOf(
  moduleKey: string,
  actions: readonly string[],
): string[] {
  return actions.map((action) => `${moduleKey}.${action}`);
}

const MANAGE_PAGES = formPages(SCHEDULE_MANAGE_KEY);
const ATTENDANCE_PAGES = formPages(SCHEDULE_ATTENDANCE_KEY);

/** 總部管理:班表管理全部(各模組 `*`;含 `use-punch-time`,規格 3.3)。 */
const HQ: RoleGrant = {
  moduleKeys: [
    SCHEDULE_GROUP_KEY,
    SCHEDULE_MY_KEY,
    SCHEDULE_MANAGE_KEY,
    ...MANAGE_PAGES,
    SCHEDULE_SETTINGS_KEY,
    SCHEDULE_ATTENDANCE_KEY,
    ...ATTENDANCE_PAGES,
  ],
  permissionKeys: [
    everything(SCHEDULE_GROUP_KEY),
    everything(SCHEDULE_MY_KEY),
    everything(SCHEDULE_MANAGE_KEY),
    ...MANAGE_PAGES.map((key) => everything(key)),
    everything(SCHEDULE_SETTINGS_KEY),
    everything(SCHEDULE_ATTENDANCE_KEY),
    ...ATTENDANCE_PAGES.map((key) => everything(key)),
  ],
};

/**
 * 店長:排自己店的班。排班作業(不含 `use-punch-time`:規格 3.3 只給總部管理)、
 * 排班設定(不含 `edit-default-rules`:總部預設值歸總部)、出勤紀錄(看全店、匯出、改對應排班、審補打卡申請)。
 */
const STORE_MANAGER: RoleGrant = {
  moduleKeys: HQ.moduleKeys,
  permissionKeys: [
    everything(SCHEDULE_GROUP_KEY),
    everything(SCHEDULE_MY_KEY),
    ...permissionsOf(SCHEDULE_MANAGE_KEY, [
      "view",
      "create",
      "edit",
      "delete",
      "auto-run",
      "publish",
      "view-day-offs",
      "edit-day-offs",
      "edit-calendar",
    ]),
    ...MANAGE_PAGES.map((key) => everything(key)),
    ...permissionsOf(SCHEDULE_SETTINGS_KEY, [
      "view",
      "edit-templates",
      "edit-staff",
      "edit-org-rules",
    ]),
    ...permissionsOf(SCHEDULE_ATTENDANCE_KEY, [
      "view",
      "create",
      "edit",
      "view-all",
      "export",
      "reassign-punches",
    ]),
    ...ATTENDANCE_PAGES.map((key) => everything(key)),
  ],
};

/** 店員:我的班表(打卡、畫休);出勤紀錄只看自己的、可以申請補打卡。 */
const CLERK: RoleGrant = {
  moduleKeys: [
    SCHEDULE_GROUP_KEY,
    SCHEDULE_MY_KEY,
    SCHEDULE_ATTENDANCE_KEY,
    ...ATTENDANCE_PAGES,
  ],
  permissionKeys: [
    everything(SCHEDULE_GROUP_KEY),
    everything(SCHEDULE_MY_KEY),
    ...permissionsOf(SCHEDULE_ATTENDANCE_KEY, ["view", "create"]),
    ...ATTENDANCE_PAGES.map((key) => everything(key)),
  ],
};

/** 班表管理(規格 3.3;權限表同 `docs/modules/project/schedule.md`「開通時建立的角色」)。 */
export const scheduleGrants: ModuleRoleGrants = {
  section: "班表管理",
  grants: { hq: HQ, "store-manager": STORE_MANAGER, clerk: CLERK },
};
