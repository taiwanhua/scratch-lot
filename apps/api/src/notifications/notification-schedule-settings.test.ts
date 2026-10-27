import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import {
  type FormOperator,
  call,
  createOperator,
  extensionsOf,
  ok,
  rootToken,
} from "../forms/test-support/form-fixtures";
import { PRINTING_AGENT_OFFLINE } from "./base-notification-types";
import { scheduleHitAt } from "./notification-schedule";
import { NotificationSettingsService } from "./notification-settings.service";
import {
  TEST_DEADLINE_NOTICE,
  TEST_EVENT_ALERT,
  TEST_EXPIRY_REMINDER,
  TEST_MONTHLY_REPORT,
  TEST_OVERDUE_REMINDER,
  TEST_RESULT_NOTICE,
} from "./test-support/schedule-fixture";

/** 專案的通知登記換成測試類型(三種寫法、當事人通知、沒宣告的類型)。 */
jest.mock("../project/notifications", () => ({
  PROJECT_NOTIFICATIONS: jest.requireActual<{
    SCHEDULE_FIXTURE_NOTIFICATIONS: unknown;
  }>("./test-support/schedule-fixture").SCHEDULE_FIXTURE_NOTIFICATIONS,
}));

jest.setTimeout(120_000);

const SCHEDULE_FIELDS = /* GraphQL */ `
  fragment ScheduleFields on NotificationSchedule {
    kind
    daysBefore
    dayOfMonth
    time
  }
`;

const NOTIFICATION_SETTINGS = /* GraphQL */ `
  query NotificationSettings($input: NotificationSettingsInput!) {
    notificationSettings(input: $input) {
      items {
        type
        category
        orgScope {
          ref
          range
        }
        audience
        isDefault
        defaultAudience
        recipientNote
        schedule {
          ...ScheduleFields
        }
        defaultSchedule {
          ...ScheduleFields
        }
        isScheduleDefault
        scheduleDateLabel
      }
      totalCount
    }
  }
  ${SCHEDULE_FIELDS}
`;

const UPDATE_SETTING = /* GraphQL */ `
  mutation UpdateNotificationSetting($input: UpdateNotificationSettingInput!) {
    updateNotificationSetting(input: $input) {
      setting {
        type
        audience
        isDefault
        schedule {
          ...ScheduleFields
        }
        isScheduleDefault
      }
    }
  }
  ${SCHEDULE_FIELDS}
`;

const RESET_SETTING = /* GraphQL */ `
  mutation ResetNotificationSetting($input: ResetNotificationSettingInput!) {
    resetNotificationSetting(input: $input) {
      setting {
        type
        isDefault
        schedule {
          ...ScheduleFields
        }
        isScheduleDefault
      }
    }
  }
  ${SCHEDULE_FIELDS}
`;

interface ScheduleRow {
  kind: string;
  daysBefore: number[] | null;
  dayOfMonth: number | null;
  time: string;
}

interface SettingRow {
  type: string;
  category: string;
  orgScope: { ref: string; range: string } | null;
  audience: Record<string, unknown> | null;
  isDefault: boolean;
  defaultAudience: Record<string, unknown> | null;
  recipientNote: string | null;
  schedule: ScheduleRow | null;
  defaultSchedule: ScheduleRow | null;
  isScheduleDefault: boolean;
  scheduleDateLabel: string | null;
}

const daysBefore = (days: number[], time = "09:00") => ({
  kind: "DAYS_BEFORE",
  daysBefore: days,
  time,
});

const EXPIRY_DEFAULT: ScheduleRow = {
  kind: "DAYS_BEFORE",
  daysBefore: [30, 7, 0],
  dayOfMonth: null,
  time: "09:00",
};

/**
 * 通知提醒時間可設定(規格 3.5 的操作表,每列一個測試):清單規則、改值 / 還原、
 * 當事人通知只有提醒時間、沒宣告的只有收件人、範圍檢查、根組織唯讀,以及排程用的查詢。
 */
describe("通知設定:提醒時間", () => {
  let api: AuthTestApp;
  let settings: NotificationSettingsService;
  let tenant: Types.ObjectId;
  let admin: FormOperator;

  const list = async (token: string) => {
    const data = await ok<{
      notificationSettings: { items: SettingRow[]; totalCount: number };
    }>(api, token, NOTIFICATION_SETTINGS, { input: { pageSize: 100 } });
    return data.notificationSettings;
  };

  const rowOf = async (type: string) => {
    const { items } = await list(admin.token);
    const row = items.find((item) => item.type === type);
    if (row === undefined) {
      throw new Error(`清單沒有 ${type}`);
    }
    return row;
  };

  const update = (input: Record<string, unknown>) =>
    call(api, admin.token, UPDATE_SETTING, { input });

  const reset = (input: Record<string, unknown>) =>
    ok(api, admin.token, RESET_SETTING, { input });

  beforeAll(async () => {
    api = await startAuthTestApp("notification-schedules");
    settings = api.app.get(NotificationSettingsService, { strict: false });
    tenant = await createOrg(api.connection, { name: "提醒時間租戶" });
    admin = await createOperator(api, api.connection, {
      orgId: tenant,
      moduleKeys: ["system.notification-settings"],
      permissionKeys: [
        "system.notification-settings.view",
        "system.notification-settings.edit",
      ],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("打開通知設定頁:所有負責人提醒 + 宣告了可調時間的當事人通知;沒宣告的當事人通知與流程類通知不在清單", async () => {
    const { items, totalCount } = await list(admin.token);
    expect(items.map((item) => item.type)).toEqual([
      PRINTING_AGENT_OFFLINE,
      TEST_EXPIRY_REMINDER,
      TEST_MONTHLY_REPORT,
      TEST_OVERDUE_REMINDER,
      TEST_EVENT_ALERT,
      TEST_DEADLINE_NOTICE,
    ]);
    expect(totalCount).toBe(6);
    expect(items.find((item) => item.type === TEST_EXPIRY_REMINDER)).toEqual(
      expect.objectContaining({
        category: "responsible",
        schedule: EXPIRY_DEFAULT,
        defaultSchedule: EXPIRY_DEFAULT,
        isScheduleDefault: true,
        scheduleDateLabel: "到期",
      }),
    );
    expect(
      items.find((item) => item.type === TEST_MONTHLY_REPORT)?.schedule,
    ).toEqual({
      kind: "MONTHLY",
      daysBefore: null,
      dayOfMonth: 3,
      time: "09:00",
    });
    expect(
      items.find((item) => item.type === TEST_OVERDUE_REMINDER)?.schedule,
    ).toEqual({
      kind: "DAILY_OVERDUE",
      daysBefore: null,
      dayOfMonth: null,
      time: "09:00",
    });
    expect(items.map((item) => item.type)).not.toContain(TEST_RESULT_NOTICE);
  });

  it("編輯「到期提醒」把 30 改成 60、儲存:之後依 60 / 7 / 0 天寄;收件人不受影響", async () => {
    const result = await update({
      type: TEST_EXPIRY_REMINDER,
      schedule: daysBefore([60, 7, 0]),
    });
    expect(result.errors).toBeUndefined();
    const row = await rowOf(TEST_EXPIRY_REMINDER);
    expect(row).toMatchObject({
      schedule: { ...EXPIRY_DEFAULT, daysBefore: [60, 7, 0] },
      defaultSchedule: EXPIRY_DEFAULT,
      isScheduleDefault: false,
      isDefault: true,
    });

    // 排程工作:取生效值 → 到期日 12/31 的前 60 天(11/1)09:00 命中,前 30 天(12/1)不再命中
    const { schedule } = await settings.effectiveSchedule(
      tenant,
      TEST_EXPIRY_REMINDER,
    );
    const check = (scheduledFor: string) =>
      scheduleHitAt(schedule, {
        scheduledFor: new Date(scheduledFor),
        timezone: "Asia/Taipei",
        date: { year: 2026, month: 12, day: 31 },
      });
    expect(check("2026-11-01T01:00:00Z")).toMatchObject({ daysBefore: 60 });
    expect(check("2026-12-01T01:00:00Z")).toBeNull();
  });

  it("編輯「到期提醒」按提醒時間的 [還原預設]:時間欄寫回 null、回到 30 / 7 / 0;調整過的收件人不受影響", async () => {
    const audience = {
      mode: "match",
      filter: {
        field: "permission",
        cond: "in",
        value: {
          kind: "static",
          values: ["system.notification-settings.edit"],
        },
      },
    };
    await ok(api, admin.token, UPDATE_SETTING, {
      input: { type: TEST_EXPIRY_REMINDER, audience },
    });
    await reset({ type: TEST_EXPIRY_REMINDER, part: "SCHEDULE" });

    const row = await rowOf(TEST_EXPIRY_REMINDER);
    expect(row).toMatchObject({
      schedule: EXPIRY_DEFAULT,
      isScheduleDefault: true,
      isDefault: false,
      audience,
    });
    const stored = await api.connection
      .collection("notification_settings")
      .findOne({ tenantId: tenant, type: TEST_EXPIRY_REMINDER });
    expect(stored?.schedule).toBeNull();
    expect(stored?.audience).toEqual(audience);

    // 不給範圍 = 可調的全部還原(收件人也回到預設)
    await reset({ type: TEST_EXPIRY_REMINDER });
    expect(await rowOf(TEST_EXPIRY_REMINDER)).toMatchObject({
      isDefault: true,
      isScheduleDefault: true,
    });
  });

  it("編輯「截止提醒」(當事人通知):只有提醒時間;收件人由事件決定,送 audience → VALIDATION_FAILED", async () => {
    const row = await rowOf(TEST_DEADLINE_NOTICE);
    expect(row).toMatchObject({
      category: "party",
      orgScope: null,
      audience: null,
      defaultAudience: null,
      isDefault: true,
      recipientNote: "表單的填寫人",
      scheduleDateLabel: "截止日",
    });

    const withAudience = await update({
      type: TEST_DEADLINE_NOTICE,
      audience: {
        mode: "match",
        filter: {
          field: "permission",
          cond: "in",
          value: { kind: "static", values: ["system.printers.edit"] },
        },
      },
    });
    expect(extensionsOf(withAudience)).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "AUDIENCE_NOT_ADJUSTABLE",
      type: TEST_DEADLINE_NOTICE,
    });
    const resetAudience = await call(api, admin.token, RESET_SETTING, {
      input: { type: TEST_DEADLINE_NOTICE, part: "AUDIENCE" },
    });
    expect(extensionsOf(resetAudience)).toMatchObject({
      reason: "AUDIENCE_NOT_ADJUSTABLE",
    });

    const saved = await update({
      type: TEST_DEADLINE_NOTICE,
      schedule: daysBefore([1], "08:00"),
    });
    expect(saved.errors).toBeUndefined();
    expect(await rowOf(TEST_DEADLINE_NOTICE)).toMatchObject({
      schedule: { daysBefore: [1], time: "08:00" },
      isScheduleDefault: false,
    });
  });

  it("編輯「異常提醒」(沒宣告可調時間):只有收件人;提醒時間是 null(發生時),送 schedule → VALIDATION_FAILED", async () => {
    const row = await rowOf(TEST_EVENT_ALERT);
    expect(row).toMatchObject({
      schedule: null,
      defaultSchedule: null,
      isScheduleDefault: true,
      scheduleDateLabel: null,
    });
    const result = await update({
      type: TEST_EVENT_ALERT,
      schedule: daysBefore([0]),
    });
    expect(extensionsOf(result)).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "SCHEDULE_NOT_ADJUSTABLE",
    });
    await expect(
      settings.effectiveSchedule(tenant, TEST_EVENT_ALERT),
    ).rejects.toThrow("沒有宣告可調時間");
  });

  it.each([
    ["提前天數 366", daysBefore([366]), "daysBefore[0]"],
    ["第 6 個", daysBefore([30, 20, 10, 7, 3, 0]), "daysBefore[5]"],
    ["重複的天數", daysBefore([7, 7]), "daysBefore[1]"],
    ["寄送時間 09:10", daysBefore([0], "09:10"), "time"],
    [
      "寫法不是類型宣告的那一種",
      { kind: "MONTHLY", dayOfMonth: 3, time: "09:00" },
      "kind",
    ],
  ])(
    "到期提醒:%s → 擋下(SCHEDULE_INVALID,path 指到出錯的欄位)",
    async (_label, schedule, path) => {
      const result = await update({ type: TEST_EXPIRY_REMINDER, schedule });
      expect(extensionsOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "SCHEDULE_INVALID",
        path,
      });
    },
  );

  it("月報提醒改成每月第 31 天:2 月在月底那天寄、4 月在 4/30 寄;第 32 天擋下", async () => {
    const tooLate = await update({
      type: TEST_MONTHLY_REPORT,
      schedule: { kind: "MONTHLY", dayOfMonth: 32, time: "09:00" },
    });
    expect(extensionsOf(tooLate)).toMatchObject({
      reason: "SCHEDULE_INVALID",
      path: "dayOfMonth",
    });
    await ok(api, admin.token, UPDATE_SETTING, {
      input: {
        type: TEST_MONTHLY_REPORT,
        schedule: { kind: "MONTHLY", dayOfMonth: 31, time: "09:00" },
      },
    });
    const { schedule } = await settings.effectiveSchedule(
      tenant,
      TEST_MONTHLY_REPORT,
    );
    const hit = (scheduledFor: string) =>
      scheduleHitAt(schedule, {
        scheduledFor: new Date(scheduledFor),
        timezone: "Asia/Taipei",
      })?.localDate ?? null;
    expect(hit("2027-02-28T01:00:00Z")).toBe("2027-02-28");
    expect(hit("2026-04-30T01:00:00Z")).toBe("2026-04-30");
    expect(hit("2026-04-03T01:00:00Z")).toBeNull();
  });

  it("08:30 把逾期提醒的時間由 09:00 改成 08:00:記下提醒時間的修改時間;今天不補寄、今天 09:00 也不寄,明天起 08:00;只改收件人不動修改時間", async () => {
    await ok(api, admin.token, UPDATE_SETTING, {
      input: {
        type: TEST_OVERDUE_REMINDER,
        schedule: { kind: "DAILY_OVERDUE", time: "08:00" },
      },
    });
    const saved = await settings.effectiveSchedule(
      tenant,
      TEST_OVERDUE_REMINDER,
    );
    expect(saved.modifiedAt).toBeInstanceOf(Date);

    // 把修改時間換成「台北 2026-12-01 08:30」來模擬那一刻改的
    const changedAt = new Date("2026-12-01T00:30:00Z");
    await api.connection
      .collection("notification_settings")
      .updateOne(
        { tenantId: tenant, type: TEST_OVERDUE_REMINDER },
        { $set: { scheduleUpdatedAt: changedAt } },
      );
    // 只改收件人:提醒時間的修改時間不動
    await ok(api, admin.token, UPDATE_SETTING, {
      input: {
        type: TEST_OVERDUE_REMINDER,
        audience: {
          mode: "match",
          filter: {
            field: "permission",
            cond: "in",
            value: {
              kind: "static",
              values: ["system.notification-settings.edit"],
            },
          },
        },
      },
    });
    const { schedule, modifiedAt } = await settings.effectiveSchedule(
      tenant,
      TEST_OVERDUE_REMINDER,
    );
    expect(modifiedAt).toEqual(changedAt);

    const occurrences = new Set<string>();
    // 改完的那一刻起,每 15 分鐘一次排程,到隔天 09:00
    for (
      let slot = changedAt.getTime();
      slot <= Date.parse("2026-12-02T01:00:00Z");
      slot += 15 * 60_000
    ) {
      const hit = scheduleHitAt(schedule, {
        scheduledFor: slot,
        timezone: "Asia/Taipei",
        date: { year: 2026, month: 11, day: 28 },
        modifiedAt,
      });
      if (hit !== null) {
        occurrences.add(hit.occurrence);
      }
    }
    expect([...occurrences]).toEqual(["2026-12-02"]);
  });

  it("存著的提醒時間寫法與類型目前宣告的不同(類型改了宣告)→ 當沒調整,清單與排程都退回預設", async () => {
    await api.connection.collection("notification_settings").updateOne(
      { tenantId: tenant, type: TEST_EXPIRY_REMINDER },
      {
        $set: { schedule: { kind: "monthly", dayOfMonth: 3, time: "09:00" } },
      },
      { upsert: true },
    );
    expect(await rowOf(TEST_EXPIRY_REMINDER)).toMatchObject({
      schedule: EXPIRY_DEFAULT,
      isScheduleDefault: true,
    });
    await expect(
      settings.effectiveSchedule(tenant, TEST_EXPIRY_REMINDER),
    ).resolves.toMatchObject({
      schedule: { kind: "days-before", daysBefore: [30, 7, 0], time: "09:00" },
    });
    await reset({ type: TEST_EXPIRY_REMINDER, part: "SCHEDULE" });
  });

  it("沒有在通知設定頁上的類型(沒宣告可調時間的當事人通知)→ UNKNOWN_TYPE;兩個欄位都沒給 → NOTHING_TO_UPDATE", async () => {
    const unknown = await update({
      type: TEST_RESULT_NOTICE,
      schedule: daysBefore([0]),
    });
    expect(extensionsOf(unknown)).toMatchObject({ reason: "UNKNOWN_TYPE" });
    const nothing = await update({
      type: TEST_EXPIRY_REMINDER,
      audience: null,
      schedule: null,
    });
    expect(extensionsOf(nothing)).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "NOTHING_TO_UPDATE",
    });
  });

  it("調整提醒時間寫稽核(before / after 帶 schedule)", async () => {
    const log = await api.connection.collection("audit_logs").findOne(
      {
        action: "notification-settings.edit",
        "after.type": TEST_OVERDUE_REMINDER,
        "before.schedule": null,
      },
      { sort: { _id: 1 } },
    );
    expect(log?.before).toMatchObject({ schedule: null });
    expect(log?.after).toMatchObject({
      schedule: { kind: "daily-overdue", time: "08:00" },
    });
  });

  it("站在根組織打開:只看得到預設值,不能改(TENANT_ONLY);排程在根組織用預設", async () => {
    const root = await rootToken(api);
    const { items } = await list(root);
    expect(items.every((item) => item.isScheduleDefault)).toBe(true);
    expect(
      items.find((item) => item.type === TEST_EXPIRY_REMINDER)?.schedule,
    ).toEqual(EXPIRY_DEFAULT);
    const rootUpdate = await call(api, root, UPDATE_SETTING, {
      input: { type: TEST_EXPIRY_REMINDER, schedule: daysBefore([1]) },
    });
    expect(extensionsOf(rootUpdate)).toMatchObject({
      code: "FORBIDDEN",
      reason: "TENANT_ONLY",
    });
    await expect(
      settings.effectiveSchedule(null, TEST_EXPIRY_REMINDER),
    ).resolves.toEqual({
      schedule: { kind: "days-before", daysBefore: [30, 7, 0], time: "09:00" },
      modifiedAt: null,
    });
  });
});
