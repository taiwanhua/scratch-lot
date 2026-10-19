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
  TEST_CLOSE_OVERDUE,
  TEST_DAY_OFF_OPEN,
  TEST_LICENSE_EXPIRY,
  TEST_ROSTER_PUBLISHED,
  TEST_SETTLE_OVERDUE,
  TEST_TRANSFER_SHIPPED,
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

const LICENSE_DEFAULT: ScheduleRow = {
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
      TEST_LICENSE_EXPIRY,
      TEST_CLOSE_OVERDUE,
      TEST_SETTLE_OVERDUE,
      TEST_TRANSFER_SHIPPED,
      TEST_DAY_OFF_OPEN,
    ]);
    expect(totalCount).toBe(6);
    expect(items.find((item) => item.type === TEST_LICENSE_EXPIRY)).toEqual(
      expect.objectContaining({
        category: "responsible",
        schedule: LICENSE_DEFAULT,
        defaultSchedule: LICENSE_DEFAULT,
        isScheduleDefault: true,
        scheduleDateLabel: "到期",
      }),
    );
    expect(
      items.find((item) => item.type === TEST_CLOSE_OVERDUE)?.schedule,
    ).toEqual({
      kind: "MONTHLY",
      daysBefore: null,
      dayOfMonth: 3,
      time: "09:00",
    });
    expect(
      items.find((item) => item.type === TEST_SETTLE_OVERDUE)?.schedule,
    ).toEqual({
      kind: "DAILY_OVERDUE",
      daysBefore: null,
      dayOfMonth: null,
      time: "09:00",
    });
    expect(items.map((item) => item.type)).not.toContain(TEST_ROSTER_PUBLISHED);
  });

  it("編輯「證照到期」把 30 改成 60、儲存:之後依 60 / 7 / 0 天寄;收件人不受影響", async () => {
    const result = await update({
      type: TEST_LICENSE_EXPIRY,
      schedule: daysBefore([60, 7, 0]),
    });
    expect(result.errors).toBeUndefined();
    const row = await rowOf(TEST_LICENSE_EXPIRY);
    expect(row).toMatchObject({
      schedule: { ...LICENSE_DEFAULT, daysBefore: [60, 7, 0] },
      defaultSchedule: LICENSE_DEFAULT,
      isScheduleDefault: false,
      isDefault: true,
    });

    // 排程工作:取生效值 → 到期日 12/31 的前 60 天(11/1)09:00 命中,前 30 天(12/1)不再命中
    const schedule = await settings.effectiveSchedule(
      tenant,
      TEST_LICENSE_EXPIRY,
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

  it("編輯「證照到期」按提醒時間的 [還原預設]:時間欄寫回 null、回到 30 / 7 / 0;調整過的收件人不受影響", async () => {
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
      input: { type: TEST_LICENSE_EXPIRY, audience },
    });
    await reset({ type: TEST_LICENSE_EXPIRY, part: "SCHEDULE" });

    const row = await rowOf(TEST_LICENSE_EXPIRY);
    expect(row).toMatchObject({
      schedule: LICENSE_DEFAULT,
      isScheduleDefault: true,
      isDefault: false,
      audience,
    });
    const stored = await api.connection
      .collection("notification_settings")
      .findOne({ tenantId: tenant, type: TEST_LICENSE_EXPIRY });
    expect(stored?.schedule).toBeNull();
    expect(stored?.audience).toEqual(audience);

    // 不給範圍 = 可調的全部還原(收件人也回到預設)
    await reset({ type: TEST_LICENSE_EXPIRY });
    expect(await rowOf(TEST_LICENSE_EXPIRY)).toMatchObject({
      isDefault: true,
      isScheduleDefault: true,
    });
  });

  it("編輯「畫休開放」(當事人通知):只有提醒時間;收件人由事件決定,送 audience → VALIDATION_FAILED", async () => {
    const row = await rowOf(TEST_DAY_OFF_OPEN);
    expect(row).toMatchObject({
      category: "party",
      orgScope: null,
      audience: null,
      defaultAudience: null,
      isDefault: true,
      recipientNote: "可排這家店的排班人員",
      scheduleDateLabel: "開放日",
    });

    const withAudience = await update({
      type: TEST_DAY_OFF_OPEN,
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
      type: TEST_DAY_OFF_OPEN,
    });
    const resetAudience = await call(api, admin.token, RESET_SETTING, {
      input: { type: TEST_DAY_OFF_OPEN, part: "AUDIENCE" },
    });
    expect(extensionsOf(resetAudience)).toMatchObject({
      reason: "AUDIENCE_NOT_ADJUSTABLE",
    });

    const saved = await update({
      type: TEST_DAY_OFF_OPEN,
      schedule: daysBefore([1], "08:00"),
    });
    expect(saved.errors).toBeUndefined();
    expect(await rowOf(TEST_DAY_OFF_OPEN)).toMatchObject({
      schedule: { daysBefore: [1], time: "08:00" },
      isScheduleDefault: false,
    });
  });

  it("編輯「調貨出貨通知」(沒宣告可調時間):只有收件人;提醒時間是 null(發生時),送 schedule → VALIDATION_FAILED", async () => {
    const row = await rowOf(TEST_TRANSFER_SHIPPED);
    expect(row).toMatchObject({
      schedule: null,
      defaultSchedule: null,
      isScheduleDefault: true,
      scheduleDateLabel: null,
    });
    const result = await update({
      type: TEST_TRANSFER_SHIPPED,
      schedule: daysBefore([0]),
    });
    expect(extensionsOf(result)).toMatchObject({
      code: "VALIDATION_FAILED",
      reason: "SCHEDULE_NOT_ADJUSTABLE",
    });
    await expect(
      settings.effectiveSchedule(tenant, TEST_TRANSFER_SHIPPED),
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
    "證照到期:%s → 擋下(SCHEDULE_INVALID,path 指到出錯的欄位)",
    async (_label, schedule, path) => {
      const result = await update({ type: TEST_LICENSE_EXPIRY, schedule });
      expect(extensionsOf(result)).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "SCHEDULE_INVALID",
        path,
      });
    },
  );

  it("關帳逾期改成每月第 31 天:2 月在月底那天寄、4 月在 4/30 寄;第 32 天擋下", async () => {
    const tooLate = await update({
      type: TEST_CLOSE_OVERDUE,
      schedule: { kind: "MONTHLY", dayOfMonth: 32, time: "09:00" },
    });
    expect(extensionsOf(tooLate)).toMatchObject({
      reason: "SCHEDULE_INVALID",
      path: "dayOfMonth",
    });
    await ok(api, admin.token, UPDATE_SETTING, {
      input: {
        type: TEST_CLOSE_OVERDUE,
        schedule: { kind: "MONTHLY", dayOfMonth: 31, time: "09:00" },
      },
    });
    const schedule = await settings.effectiveSchedule(
      tenant,
      TEST_CLOSE_OVERDUE,
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

  it("08:30 把日結逾期的時間由 09:00 改成 08:00:今天不補寄、今天 09:00 也不寄;明天起 08:00", async () => {
    await ok(api, admin.token, UPDATE_SETTING, {
      input: {
        type: TEST_SETTLE_OVERDUE,
        schedule: { kind: "DAILY_OVERDUE", time: "08:00" },
      },
    });
    const schedule = await settings.effectiveSchedule(
      tenant,
      TEST_SETTLE_OVERDUE,
    );
    const hits: string[] = [];
    // 台北 2026-12-01 08:30(改完的那一刻)起,每 15 分鐘一次排程,到隔天 09:00
    for (
      let slot = Date.parse("2026-12-01T00:30:00Z");
      slot <= Date.parse("2026-12-02T01:00:00Z");
      slot += 15 * 60_000
    ) {
      const hit = scheduleHitAt(schedule, {
        scheduledFor: slot,
        timezone: "Asia/Taipei",
        date: { year: 2026, month: 11, day: 28 },
      });
      if (hit !== null) {
        hits.push(hit.localDate);
      }
    }
    expect(hits).toEqual(["2026-12-02"]);
  });

  it("沒有在通知設定頁上的類型(沒宣告可調時間的當事人通知)→ UNKNOWN_TYPE;兩個欄位都沒給 → NOTHING_TO_UPDATE", async () => {
    const unknown = await update({
      type: TEST_ROSTER_PUBLISHED,
      schedule: daysBefore([0]),
    });
    expect(extensionsOf(unknown)).toMatchObject({ reason: "UNKNOWN_TYPE" });
    const nothing = await update({
      type: TEST_LICENSE_EXPIRY,
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
        "after.type": TEST_SETTLE_OVERDUE,
      },
      { sort: { _id: -1 } },
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
      items.find((item) => item.type === TEST_LICENSE_EXPIRY)?.schedule,
    ).toEqual(LICENSE_DEFAULT);
    const rootUpdate = await call(api, root, UPDATE_SETTING, {
      input: { type: TEST_LICENSE_EXPIRY, schedule: daysBefore([1]) },
    });
    expect(extensionsOf(rootUpdate)).toMatchObject({
      code: "FORBIDDEN",
      reason: "TENANT_ONLY",
    });
    await expect(
      settings.effectiveSchedule(null, TEST_LICENSE_EXPIRY),
    ).resolves.toEqual({
      kind: "days-before",
      daysBefore: [30, 7, 0],
      time: "09:00",
    });
  });
});
