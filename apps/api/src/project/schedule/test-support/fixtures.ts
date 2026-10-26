import type { Connection, Types } from "mongoose";

import type { AuthTestApp } from "../../../auth/test-support/auth-app";
import { createUser } from "../../../auth/test-support/fixtures";
import { PASSWORD, login } from "../../../fields/test-support/fixtures";
import { createRole } from "../../../permission/test-support/fixtures";

/**
 * 排班設定的測試夾具。api 的測試資料庫以底座夾具 registry 種(`BASE_ONLY_REGISTRY`),
 * 不含專案的模組宣告 —— 測試要用到的班表管理模組與權限由這裡直接寫進**隔離的測試資料庫**
 * (形狀照 `apps/db-migrator/seeds/project/schedule.ts`;先例 `test-support/project-fixture/fixtures.ts`)。
 */

/** 測試用到的模組:key → 上層 key。 */
const MODULES: readonly [key: string, parentKey: string | null][] = [
  ["schedule", null],
  ["schedule.settings", "schedule"],
  ["schedule.manage", "schedule"],
  ["schedule.my", "schedule"],
  ["schedule.attendance", "schedule"],
];

/** 表單模組(出勤紀錄綁定 補打卡申請);其他是固定頁。 */
const FORM_MODULES = new Set(["schedule.attendance"]);

/** 測試用到的權限:key → 所在模組。 */
export const SCHEDULE_TEST_PERMISSIONS = {
  settingsView: "schedule.settings.view",
  editTemplates: "schedule.settings.edit-templates",
  editStaff: "schedule.settings.edit-staff",
  editDefaultRules: "schedule.settings.edit-default-rules",
  editOrgRules: "schedule.settings.edit-org-rules",
  manageView: "schedule.manage.view",
  manageEdit: "schedule.manage.edit",
  editCalendar: "schedule.manage.edit-calendar",
  viewDayOffs: "schedule.manage.view-day-offs",
  editDayOffs: "schedule.manage.edit-day-offs",
  myEditDayOffs: "schedule.my.edit-day-offs",
  myView: "schedule.my.view",
  myPunch: "schedule.my.punch",
  publish: "schedule.manage.publish",
  autoRun: "schedule.manage.auto-run",
  usePunchTime: "schedule.manage.use-punch-time",
  attendanceView: "schedule.attendance.view",
  attendanceCreate: "schedule.attendance.create",
  attendanceEdit: "schedule.attendance.edit",
  attendanceDelete: "schedule.attendance.delete",
  attendanceViewAll: "schedule.attendance.view-all",
  attendanceExport: "schedule.attendance.export",
  reassignPunches: "schedule.attendance.reassign-punches",
} as const;

export const ALL_SCHEDULE_TEST_PERMISSIONS = Object.values(
  SCHEDULE_TEST_PERMISSIONS,
);

const MODULE_KEYS = MODULES.map(([key]) => key);

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

/** 寫入班表管理的模組與權限(每個測試資料庫呼叫一次)。 */
export async function seedScheduleAuthorization(
  connection: Connection,
): Promise<void> {
  const now = new Date();
  const ids = new Map<string, Types.ObjectId>();
  for (const [index, [key, parentKey]] of MODULES.entries()) {
    const parentId = parentKey === null ? null : (ids.get(parentKey) ?? null);
    const { insertedId } = await connection.collection("modules").insertOne({
      key,
      name: key,
      parentId,
      ancestors: parentId === null ? [] : [parentId],
      route: key.split(".").at(-1),
      sidebarType: parentKey === null ? "group" : "link",
      order: 900 + index,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: FORM_MODULES.has(key) ? "form" : "fixed",
      ...baseFields(now),
    });
    ids.set(key, insertedId);
  }
  await connection.collection("permissions").insertMany(
    ALL_SCHEDULE_TEST_PERMISSIONS.map((key) => ({
      key,
      moduleId: ids.get(key.slice(0, key.lastIndexOf("."))),
      name: key,
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...baseFields(now),
    })),
  );
}

let accountSequence = 0;

export interface ScheduleTestUser {
  userId: Types.ObjectId;
  account: string;
  token: string;
}

/** 建一位所屬組織為 `orgIds` 的使用者(第一個 = 當前組織),授予這些權限並登入。 */
export async function createScheduleUser(
  api: AuthTestApp,
  connection: Connection,
  orgIds: Types.ObjectId[],
  permissionKeys: readonly string[],
  name?: string,
): Promise<ScheduleTestUser> {
  accountSequence += 1;
  const account = name ?? `schedule-user-${String(accountSequence)}`;
  const userId = await createUser(connection, {
    account,
    password: PASSWORD,
    orgIds,
  });
  const [ownerOrgId] = orgIds;
  if (ownerOrgId === undefined) {
    throw new Error("createScheduleUser 需要至少一個所屬組織");
  }
  if (permissionKeys.length > 0) {
    await createRole(api.app, connection, {
      name: `排班角色:${account}`,
      ownerOrgId,
      moduleKeys: MODULE_KEYS,
      permissionKeys: [...permissionKeys],
      assignTo: [userId],
    });
  }
  const token = permissionKeys.length > 0 ? await login(api, account) : "";
  return { userId, account, token };
}

/**
 * 測試用的排班下拉選項(正式環境由專案 seed 種;api 測試庫只有底座種子)。
 * 第三格是顯示名稱(沒給 = 同 value);代改畫休原因照專案 seed 給中文名稱,通知內文才驗得到「顯示名稱」。
 */
const SCHEDULE_TEST_OPTIONS: Record<
  string,
  [value: string, enabled: boolean, label?: string][]
> = {
  "schedule-position": [
    ["in-store-counter", true],
    ["outdoor-stall", true],
    ["restock", true],
    ["retired-position", false],
  ],
  "schedule-task": [
    ["store-and-accounts-lead", true],
    ["store-duties", true],
  ],
  "schedule-day-off-override-reason": [
    ["staff-late-notice", true, "員工臨時告知"],
    ["entry-error", true, "登記錯誤"],
    ["other", true, "其他"],
  ],
  "schedule-change-reason": [
    ["shift-swap", true],
    ["retired-reason", false],
    ["other", true],
  ],
  "schedule-makeup-punch-reason": [
    ["forgot-punch", true],
    ["other", true],
  ],
  "schedule-entry-reassign-reason": [
    ["shift-swap", true],
    ["retired-reassign", false],
    ["other", true],
  ],
  "schedule-special-day-category": [
    ["national-holiday", true],
    ["event-day", true],
    ["other", true],
  ],
};

/** 寫入排班用到的欄位管理類別與全域選項(`retired-position` 是停用的選項)。 */
export async function seedScheduleFieldOptions(
  connection: Connection,
): Promise<void> {
  const now = new Date();
  for (const [key, options] of Object.entries(SCHEDULE_TEST_OPTIONS)) {
    const { insertedId: categoryId } = await connection
      .collection("field_categories")
      .insertOne({
        key,
        name: key,
        isSystem: true,
        enabled: true,
        ...baseFields(now),
      });
    await connection.collection("fields").insertMany(
      options.map(([value, enabled, label], index) => ({
        key: `${key}:${value}`,
        categoryId,
        orgId: null,
        label: label ?? value,
        value,
        order: index + 1,
        enabled,
        isSystem: true,
        ...baseFields(now),
      })),
    );
  }
}
