import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import type { RealtimePublishRequest } from "@repo/domain/realtime";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg } from "../auth/test-support/fixtures";
import {
  FormsRepository,
  ModulesRepository,
  OrgsRepository,
  PermissionsRepository,
  RolesRepository,
  UsersRepository,
} from "../database/database.module";
import { RelationService } from "../database/relation.service";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { TransactionService } from "../database/transaction";
import {
  type FormOperator,
  call,
  codeOf,
  createOperator,
  extensionsOf,
  ok,
  rootToken,
} from "../forms/test-support/form-fixtures";
import { MailService } from "../mail/mail.service";
import { RecordingMailService } from "../mail/recording-mail.service";
import { RealtimeTransport } from "../realtime/realtime-transport";
import {
  PRINTING_AGENT_OFFLINE,
  PRINTING_JOB_FAILED,
  WORKFLOW_INSTANCE_REF,
  WORKFLOW_RESULT,
  WORKFLOW_TASK_CREATED,
} from "./base-notification-types";
import { EmailChannelAdapter } from "./notification-channels";
import {
  type NotificationTypeDefinition,
  notificationPreferenceKey,
} from "./notification-registry";
import { NOTIFICATION_TYPES } from "./notification-registry.module";
import { NotificationService, type NotifyInput } from "./notification.service";

jest.setTimeout(120_000);

const MY_NOTIFICATIONS = /* GraphQL */ `
  query MyNotifications($input: MyNotificationsInput!) {
    myNotifications(input: $input) {
      items {
        id
        type
        title
        body
        refType
        refId
        link
        readAt
      }
      page
      pageSize
      totalCount
      unreadCount
    }
  }
`;

const UNREAD_COUNT = /* GraphQL */ `
  query {
    myNotificationUnreadCount {
      count
    }
  }
`;

const MARK_READ = /* GraphQL */ `
  mutation MarkNotificationsRead($input: MarkNotificationsReadInput!) {
    markNotificationsRead(input: $input) {
      unreadCount
    }
  }
`;

const MARK_ALL_READ = /* GraphQL */ `
  mutation {
    markAllNotificationsRead {
      unreadCount
    }
  }
`;

const MY_NOTIFICATION_PREFERENCES = /* GraphQL */ `
  query {
    myNotificationPreferences {
      items {
        type
        name
        channels {
          channel
          preferenceKey
          enabled
          canDisable
        }
      }
    }
  }
`;

const UPDATE_MY_PREFERENCES = /* GraphQL */ `
  mutation UpdateMyPreferences($input: UpdateMyPreferencesInput!) {
    updateMyPreferences(input: $input) {
      settings
    }
  }
`;

const NOTIFICATION_SETTINGS = /* GraphQL */ `
  query NotificationSettings($input: NotificationSettingsInput!) {
    notificationSettings(input: $input) {
      items {
        type
        name
        orgScope {
          ref
          range
        }
        audience
        isDefault
        defaultAudience
        schedule {
          kind
        }
        isScheduleDefault
      }
      totalCount
    }
  }
`;

const UPDATE_SETTING = /* GraphQL */ `
  mutation UpdateNotificationSetting($input: UpdateNotificationSettingInput!) {
    updateNotificationSetting(input: $input) {
      setting {
        type
        audience
        isDefault
      }
    }
  }
`;

const RESET_SETTING = /* GraphQL */ `
  mutation ResetNotificationSetting($input: ResetNotificationSettingInput!) {
    resetNotificationSetting(input: $input) {
      setting {
        type
        audience
        isDefault
        defaultAudience
      }
    }
  }
`;

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
  link: string | null;
  readAt: string | null;
}

interface MyNotificationsData {
  myNotifications: {
    items: NotificationRow[];
    page: number;
    pageSize: number;
    totalCount: number;
    unreadCount: number;
  };
}

interface SettingRow {
  type: string;
  audience: Record<string, unknown>;
  isDefault: boolean;
  defaultAudience?: Record<string, unknown>;
}

const PRINTERS_EDIT = "system.printers.edit";

const SETTINGS_PERMISSIONS = [
  "system.notification-settings.view",
  "system.notification-settings.edit",
];

const usersAudience = (...ids: Types.ObjectId[]) => ({
  mode: "match",
  filter: {
    field: "user",
    cond: "in",
    value: { kind: "static", values: ids.map(String) },
  },
});

/**
 * 通知:`notify()` 的交易、去重、偏好與 email 總開關,通知清單 API,
 * 負責人提醒的通知設定。即時通道在測試裡是停用的(記錄用 adapter),這裡攔它的 `send`;
 * 信件走記錄用 adapter(`RecordingMailService.sent`)。
 */
describe("通知 notify() / 通知清單 / 通知設定", () => {
  let api: AuthTestApp;
  let service: NotificationService;
  let transactions: TransactionService;
  let mail: RecordingMailService;
  const signals: RealtimePublishRequest[] = [];

  let tenant: Types.ObjectId;
  let store: Types.ObjectId;
  let otherStore: Types.ObjectId;
  /** 租戶管理員(站在租戶頂層;通知設定 view + edit)。 */
  let admin: FormOperator;
  /** 台北店兩位、另一家店一位(都沒有任何通知設定權限)。 */
  let alice: FormOperator;
  let bob: FormOperator;
  let carol: FormOperator;
  let sequence = 0;

  const nextKey = (label: string) => {
    sequence += 1;
    return `test:${label}:${String(sequence)}`;
  };

  const notificationSignalsSince = (from: number): string[][] =>
    signals
      .slice(from)
      .filter((request) => request.signal.type === "notification")
      .map((request) => request.topics);

  const mailsSince = (from: number) => mail.sent.slice(from);

  const topicOf = (who: FormOperator) => `user:${String(who.userId)}`;

  const partyInput = (
    type: string,
    recipients: FormOperator[],
    dedupeKey: string,
  ): NotifyInput => ({
    type,
    tenantId: tenant,
    orgId: store,
    recipients: {
      kind: "users",
      userIds: recipients.map((who) => who.userId),
    },
    params: { subject: "請假單:九月特休", stepName: "主管核准" },
    ref: {
      type: WORKFLOW_INSTANCE_REF,
      id: new Types.ObjectId().toHexString(),
    },
    dedupeKey,
  });

  const rowsOf = (dedupeKey: string) =>
    api.connection.collection("notifications").find({ dedupeKey }).toArray();

  const listOf = async (
    who: FormOperator,
    input: Record<string, unknown> = {},
  ) => {
    const data = await ok<MyNotificationsData>(
      api,
      who.token,
      MY_NOTIFICATIONS,
      { input },
    );
    return data.myNotifications;
  };

  const setPreference = (
    who: FormOperator,
    settings: Record<string, unknown>,
  ) => call(api, who.token, UPDATE_MY_PREFERENCES, { input: { settings } });

  /** 改偏好且必須成功。 */
  const savePreference = async (
    who: FormOperator,
    settings: Record<string, unknown>,
  ) => {
    const result = await setPreference(who, settings);
    expect(result.errors).toBeUndefined();
  };

  const offlineInput = (dedupeKey: string): NotifyInput => ({
    type: PRINTING_AGENT_OFFLINE,
    tenantId: tenant,
    orgId: store,
    params: { agentName: "櫃台", orgName: "台北店" },
    dedupeKey,
  });

  const recipientsOf = async (dedupeKey: string) => {
    const rows = await rowsOf(dedupeKey);
    return rows
      .map((row) => String(row.recipientId))
      .toSorted((a, b) => a.localeCompare(b));
  };

  beforeAll(async () => {
    api = await startAuthTestApp("notifications", {
      WORKFLOW_MAIL_ENABLED: "true",
    });
    service = api.app.get(NotificationService, { strict: false });
    transactions = api.app.get(TransactionService, { strict: false });
    const resolved = api.app.get(MailService, { strict: false });
    if (!(resolved instanceof RecordingMailService)) {
      throw new TypeError("測試應使用記錄用 adapter");
    }
    mail = resolved;
    const transport = api.app.get(RealtimeTransport, { strict: false });
    jest.spyOn(transport, "send").mockImplementation((request) => {
      signals.push(request);
      return Promise.resolve();
    });

    tenant = await createOrg(api.connection, { name: "通知租戶" });
    store = await createOrg(api.connection, {
      name: "台北店",
      parentId: tenant,
    });
    otherStore = await createOrg(api.connection, {
      name: "台中店",
      parentId: tenant,
    });
    admin = await createOperator(api, api.connection, {
      orgId: tenant,
      moduleKeys: ["system.notification-settings"],
      permissionKeys: SETTINGS_PERMISSIONS,
    });
    alice = await createOperator(api, api.connection, {
      orgId: store,
      ownerOrgId: tenant,
      moduleKeys: [],
      permissionKeys: [],
    });
    bob = await createOperator(api, api.connection, {
      orgId: store,
      ownerOrgId: tenant,
      moduleKeys: [],
      permissionKeys: [],
    });
    carol = await createOperator(api, api.connection, {
      orgId: otherStore,
      ownerOrgId: tenant,
      moduleKeys: [],
      permissionKeys: [],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("notify():交易、去重", () => {
    it("同一 dedupeKey 只產生一筆:重複呼叫不再寫入、不再送信號、不再寄信", async () => {
      const dedupeKey = nextKey("dedupe");
      const fromSignals = signals.length;
      const fromMails = mail.sent.length;
      const input = partyInput(WORKFLOW_RESULT, [alice], dedupeKey);
      await service.notify(input);
      await service.notify(input);
      await transactions.withTransaction(async () => {
        await service.notify(input);
      });

      expect(await rowsOf(dedupeKey)).toHaveLength(1);
      expect(notificationSignalsSince(fromSignals)).toEqual([[topicOf(alice)]]);
      expect(
        mailsSince(fromMails).filter(
          (message) => message.notificationType === WORKFLOW_RESULT,
        ),
      ).toHaveLength(1);
    });

    it("同一事件通知多位收件人:每人一筆,一次送出信號到所有人的頻道", async () => {
      const dedupeKey = nextKey("many");
      const fromSignals = signals.length;
      await service.notify(
        partyInput(WORKFLOW_RESULT, [alice, bob], dedupeKey),
      );

      expect(await rowsOf(dedupeKey)).toHaveLength(2);
      const sent = notificationSignalsSince(fromSignals);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual(
        expect.arrayContaining([topicOf(alice), topicOf(bob)]),
      );
    });

    it("動作回復則沒有通知、沒有信號、沒有信", async () => {
      const dedupeKey = nextKey("rollback");
      const fromSignals = signals.length;
      const fromMails = mail.sent.length;
      await expect(
        transactions.withTransaction(async () => {
          await service.notify(partyInput(WORKFLOW_RESULT, [alice], dedupeKey));
          throw new Error("模擬動作在寫完通知之後失敗");
        }),
      ).rejects.toThrow("模擬動作");

      expect(await rowsOf(dedupeKey)).toEqual([]);
      expect(notificationSignalsSince(fromSignals)).toEqual([]);
      expect(mailsSince(fromMails)).toEqual([]);
    });

    it("沒登記的類型、當事人通知沒給收件人、負責人提醒給了收件人 → 程式錯誤", async () => {
      await expect(
        service.notify({ ...partyInput("nope.type", [alice], nextKey("x")) }),
      ).rejects.toThrow("沒有登記");
      await expect(
        service.notify({
          type: WORKFLOW_RESULT,
          tenantId: tenant,
          orgId: store,
          dedupeKey: nextKey("x"),
        }),
      ).rejects.toThrow("recipients");
      await expect(
        service.notify(
          partyInput(PRINTING_AGENT_OFFLINE, [alice], nextKey("x")),
        ),
      ).rejects.toThrow("負責人提醒");
    });

    it("標題 / 內容依收件人的語言產生(沒有該語言 → 繁中)", async () => {
      await savePreference(bob, { locale: "en" });
      const dedupeKey = nextKey("locale");
      await service.notify(
        partyInput(WORKFLOW_TASK_CREATED, [alice, bob], dedupeKey),
      );
      const rows = await rowsOf(dedupeKey);
      const titleOf = (who: FormOperator) =>
        String(
          rows.find((row) => String(row.recipientId) === String(who.userId))
            ?.title,
        );
      expect(titleOf(alice)).toBe("待審核:請假單:九月特休");
      expect(titleOf(bob)).toBe("Pending review: 請假單:九月特休");
      await setPreference(bob, { locale: null });
    });
  });

  describe("開關三層:個人偏好 × 環境總開關", () => {
    it("使用者在偏好分頁關掉 workflow.result 的 email → 之後只收站內通知", async () => {
      const emailKey = notificationPreferenceKey(WORKFLOW_RESULT, "email");
      await savePreference(alice, { [emailKey]: false });
      const dedupeKey = nextKey("no-email");
      const fromSignals = signals.length;
      const fromMails = mail.sent.length;
      await service.notify(partyInput(WORKFLOW_RESULT, [alice], dedupeKey));

      expect(await rowsOf(dedupeKey)).toHaveLength(1);
      expect(notificationSignalsSince(fromSignals)).toEqual([[topicOf(alice)]]);
      expect(mailsSince(fromMails)).toEqual([]);
      await setPreference(alice, { [emailKey]: null });
    });

    it("關掉站內、email 開著 → 只寄信:清單與未讀數不算它、不送信號(仍存一筆供去重)", async () => {
      const inAppKey = notificationPreferenceKey(WORKFLOW_RESULT, "in-app");
      await savePreference(bob, { [inAppKey]: false });
      const before = await listOf(bob);
      const dedupeKey = nextKey("no-in-app");
      const fromSignals = signals.length;
      const fromMails = mail.sent.length;
      await service.notify(partyInput(WORKFLOW_RESULT, [bob], dedupeKey));
      await service.notify(partyInput(WORKFLOW_RESULT, [bob], dedupeKey));

      const rows = await rowsOf(dedupeKey);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.channels).toEqual(["email"]);
      expect(notificationSignalsSince(fromSignals)).toEqual([]);
      expect(mailsSince(fromMails)).toHaveLength(1);
      const after = await listOf(bob);
      expect(after.totalCount).toBe(before.totalCount);
      expect(after.unreadCount).toBe(before.unreadCount);
      await setPreference(bob, { [inAppKey]: null });
    });

    it("workflow.task-created 的站內開關不能關:API 收到關閉要求 → VALIDATION_FAILED;開關顯示為停用", async () => {
      const inAppKey = notificationPreferenceKey(
        WORKFLOW_TASK_CREATED,
        "in-app",
      );
      const rejected = await setPreference(alice, { [inAppKey]: false });
      expect(codeOf(rejected)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(rejected)).toMatchObject({
        reason: "INVALID_VALUE",
        key: inAppKey,
      });
      // 送 true(維持開)與 null(回到預設)照常
      await savePreference(alice, { [inAppKey]: true });
      await savePreference(alice, { [inAppKey]: null });

      const { myNotificationPreferences } = await ok<{
        myNotificationPreferences: {
          items: {
            type: string;
            channels: {
              channel: string;
              preferenceKey: string;
              enabled: boolean;
              canDisable: boolean;
            }[];
          }[];
        };
      }>(api, alice.token, MY_NOTIFICATION_PREFERENCES);
      const taskCreated = myNotificationPreferences.items.find(
        (item) => item.type === WORKFLOW_TASK_CREATED,
      );
      expect(taskCreated?.channels).toEqual([
        {
          channel: "in-app",
          preferenceKey: inAppKey,
          enabled: true,
          canDisable: false,
        },
        {
          channel: "email",
          preferenceKey: notificationPreferenceKey(
            WORKFLOW_TASK_CREATED,
            "email",
          ),
          enabled: true,
          canDisable: true,
        },
      ]);
      expect(myNotificationPreferences.items.map((item) => item.type)).toEqual(
        expect.arrayContaining([
          WORKFLOW_RESULT,
          PRINTING_JOB_FAILED,
          PRINTING_AGENT_OFFLINE,
        ]),
      );
    });

    it("canDisable = false 的管道:就算偏好裡存著 false(繞過 API),notify 照樣送站內通知", async () => {
      const inAppKey = notificationPreferenceKey(
        WORKFLOW_TASK_CREATED,
        "in-app",
      );
      await api.connection
        .collection("user_preferences")
        .updateOne(
          { userId: carol.userId },
          { $set: { [`settings.${inAppKey}`]: false } },
          { upsert: true },
        );
      const dedupeKey = nextKey("locked");
      const fromSignals = signals.length;
      await service.notify(
        partyInput(WORKFLOW_TASK_CREATED, [carol], dedupeKey),
      );
      const rows = await rowsOf(dedupeKey);
      expect(rows[0]?.channels).toContain("in-app");
      expect(notificationSignalsSince(fromSignals)).toEqual([[topicOf(carol)]]);
    });

    it("WORKFLOW_MAIL_ENABLED 關 → 所有類型的 email 只寫 log、不寄;站內通知照常寫入與送出信號", async () => {
      const adapter = api.app.get(EmailChannelAdapter, { strict: false });
      const spy = jest.spyOn(adapter, "isEnabled").mockReturnValue(false);
      const dedupeKey = nextKey("switch-off");
      const fromSignals = signals.length;
      const fromMails = mail.sent.length;
      await service.notify(
        partyInput(WORKFLOW_TASK_CREATED, [alice], dedupeKey),
      );

      spy.mockRestore();

      expect(await rowsOf(dedupeKey)).toHaveLength(1);
      expect(notificationSignalsSince(fromSignals)).toEqual([[topicOf(alice)]]);
      expect(mailsSince(fromMails)).toEqual([]);
    });

    it("WORKFLOW_MAIL_ENABLED 開、使用者沒關 → 依 defaultChannels 寄出;內容 = 通知的標題 / 內容 + 完整連結", async () => {
      const dedupeKey = nextKey("switch-on");
      const fromMails = mail.sent.length;
      const input = partyInput(WORKFLOW_TASK_CREATED, [alice], dedupeKey);
      await service.notify(input);

      const sent = mailsSince(fromMails);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        kind: "notification",
        notificationType: WORKFLOW_TASK_CREATED,
      });
      expect(sent[0]?.to).toMatch(/@example\.com$/);
      expect(sent[0]?.subject).toContain("待審核:請假單:九月特休");
      expect(sent[0]?.link).toMatch(
        new RegExp(`/apply-center/view-page/${input.ref?.id ?? ""}$`),
      );
    });

    it("寄信失敗不影響觸發它的動作:交易照常提交、站內通知照常送", async () => {
      const spy = jest
        .spyOn(mail, "sendNotificationEmail")
        .mockRejectedValue(new Error("模擬寄信失敗"));
      try {
        const dedupeKey = nextKey("mail-fail");
        const fromSignals = signals.length;
        await transactions.withTransaction(async () => {
          await service.notify(partyInput(WORKFLOW_RESULT, [alice], dedupeKey));
        });
        expect(await rowsOf(dedupeKey)).toHaveLength(1);
        expect(notificationSignalsSince(fromSignals)).toEqual([
          [topicOf(alice)],
        ]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("通知清單 API", () => {
    let reader: FormOperator;
    const ids: string[] = [];

    beforeAll(async () => {
      reader = await createOperator(api, api.connection, {
        orgId: store,
        ownerOrgId: tenant,
        moduleKeys: [],
        permissionKeys: [],
      });
      for (let index = 0; index < 3; index += 1) {
        await service.notify({
          ...partyInput(WORKFLOW_RESULT, [reader], nextKey("list")),
          params: { subject: `第 ${String(index)} 張`, result: "approved" },
        });
      }
      // 沒有登記的連結種類 → link 為 null
      await service.notify({
        ...partyInput(WORKFLOW_RESULT, [reader], nextKey("list")),
        params: { subject: "沒有連結", result: "approved" },
        ref: { type: "unregistered-ref", id: "x" },
      });
    });

    it("依時間新到舊、分頁;每則帶連結登記表換成的路徑", async () => {
      const first = await listOf(reader, { page: 1, pageSize: 3 });
      expect(first.totalCount).toBe(4);
      expect(first.unreadCount).toBe(4);
      expect(first.items).toHaveLength(3);
      expect(first.items[0]?.title).toBe("申請已核准:沒有連結");
      expect(first.items[0]?.link).toBeNull();
      expect(first.items[1]?.title).toBe("申請已核准:第 2 張");
      expect(first.items[1]?.link).toBe(
        `/apply-center/view-page/${first.items[1]?.refId ?? ""}`,
      );
      const second = await listOf(reader, { page: 2, pageSize: 3 });
      expect(second.items.map((item) => item.title)).toEqual([
        "申請已核准:第 0 張",
      ]);
      ids.push(...first.items.map((item) => item.id));
    });

    it("標已讀 → 未讀數減少;「未讀」只列未讀;別人的通知標不到", async () => {
      const marked = await ok<{
        markNotificationsRead: { unreadCount: number };
      }>(api, reader.token, MARK_READ, {
        input: { ids: [ids[0], "not-an-id"] },
      });
      expect(marked.markNotificationsRead.unreadCount).toBe(3);
      const unread = await listOf(reader, { unreadOnly: true });
      expect(unread.items.map((item) => item.id)).not.toContain(ids[0]);
      expect(unread.totalCount).toBe(3);

      // alice 拿 reader 的通知 id 標已讀:不動別人的
      await ok(api, alice.token, MARK_READ, { input: { ids: [ids[1]] } });
      const count = await ok<{ myNotificationUnreadCount: { count: number } }>(
        api,
        reader.token,
        UNREAD_COUNT,
      );
      expect(count.myNotificationUnreadCount.count).toBe(3);
    });

    it("全部標已讀 → 未讀數 0", async () => {
      const result = await ok<{
        markAllNotificationsRead: { unreadCount: number };
      }>(api, reader.token, MARK_ALL_READ);
      expect(result.markAllNotificationsRead.unreadCount).toBe(0);
      const unread = await listOf(reader, { unreadOnly: true });
      expect(unread.items).toEqual([]);
    });
  });

  describe("負責人提醒 × 通知設定", () => {
    /** 台北店、持有 system.printers.edit(類型宣告的預設條件)的人。 */
    let printerAdmin: FormOperator;
    /** 台中店、同樣持有 system.printers.edit:不在台北店事件的組織範圍內。 */
    let farPrinterAdmin: FormOperator;

    beforeAll(async () => {
      // system.printers.edit 由印表機管理模組種下(seeds/base/modules/system.ts);綁模組才算持有(ADR-0011 步驟 3)
      printerAdmin = await createOperator(api, api.connection, {
        orgId: store,
        ownerOrgId: tenant,
        moduleKeys: ["system.notification-settings", "system.printers"],
        permissionKeys: [PRINTERS_EDIT],
      });
      farPrinterAdmin = await createOperator(api, api.connection, {
        orgId: otherStore,
        ownerOrgId: tenant,
        moduleKeys: ["system.notification-settings", "system.printers"],
        permissionKeys: [PRINTERS_EDIT],
      });
    });

    it("沒有調整時用類型宣告的預設人員條件(isDefault)", async () => {
      const { notificationSettings } = await ok<{
        notificationSettings: {
          items: (SettingRow & { orgScope: unknown })[];
          totalCount: number;
        };
      }>(api, admin.token, NOTIFICATION_SETTINGS, { input: {} });
      // 清單 = 底座 + 專案登記的負責人提醒 + 宣告了可調時間的當事人通知(數量從 app 實際組裝的登記推出,專案加了類型這裡照樣綠)
      expect(notificationSettings.totalCount).toBe(
        [
          ...api.app
            .get<ReadonlyMap<string, NotificationTypeDefinition>>(
              NOTIFICATION_TYPES,
              { strict: false },
            )
            .values(),
        ].filter(
          (type) =>
            type.category === "responsible" || type.schedule !== undefined,
        ).length,
      );
      const offline = notificationSettings.items.find(
        (item) => item.type === PRINTING_AGENT_OFFLINE,
      );
      expect(offline).toMatchObject({
        type: PRINTING_AGENT_OFFLINE,
        isDefault: true,
        orgScope: { ref: "event-org", range: "ancestors" },
        schedule: null,
        isScheduleDefault: true,
      });
      expect(offline?.audience).toEqual(offline?.defaultAudience);
    });

    it("租戶調整人員條件後,下一次觸發依新條件(且只在類型宣告的組織範圍內);還原預設後回到類型宣告", async () => {
      // 條件:alice 與 carol;組織範圍 = 事件的店(台北店)含上層 → 台中店的 carol 不在範圍內
      await ok(api, admin.token, UPDATE_SETTING, {
        input: {
          type: PRINTING_AGENT_OFFLINE,
          audience: usersAudience(alice.userId, carol.userId),
        },
      });
      const firstKey = nextKey("offline");
      await service.notify(offlineInput(firstKey));
      expect(await recipientsOf(firstKey)).toEqual([String(alice.userId)]);

      // 改成 bob → 下一次就是 bob
      await ok(api, admin.token, UPDATE_SETTING, {
        input: {
          type: PRINTING_AGENT_OFFLINE,
          audience: usersAudience(bob.userId),
        },
      });
      const secondKey = nextKey("offline");
      await service.notify(offlineInput(secondKey));
      expect(await recipientsOf(secondKey)).toEqual([String(bob.userId)]);

      // 還原預設 → 回到類型宣告(持有 system.printers.edit,且在台北店含上層)
      const reset = await ok<{
        resetNotificationSetting: { setting: SettingRow };
      }>(api, admin.token, RESET_SETTING, {
        input: { type: PRINTING_AGENT_OFFLINE },
      });
      expect(reset.resetNotificationSetting.setting.isDefault).toBe(true);
      expect(reset.resetNotificationSetting.setting.audience).toEqual(
        reset.resetNotificationSetting.setting.defaultAudience,
      );
      const thirdKey = nextKey("offline");
      await service.notify(offlineInput(thirdKey));
      expect(await recipientsOf(thirdKey)).toEqual([
        String(printerAdmin.userId),
      ]);
      expect(await recipientsOf(thirdKey)).not.toContain(
        String(farPrinterAdmin.userId),
      );
    });

    it("TX-02:交易內解析收件人時依序讀(人員條件的群組與權限反推都不平行查)", async () => {
      await ok(api, admin.token, UPDATE_SETTING, {
        input: {
          type: PRINTING_AGENT_OFFLINE,
          audience: {
            mode: "match",
            filter: {
              op: "OR",
              children: [
                {
                  field: "permission",
                  cond: "in",
                  value: { kind: "static", values: [PRINTERS_EDIT] },
                },
                {
                  op: "AND",
                  children: [
                    {
                      field: "user",
                      cond: "in",
                      value: { kind: "static", values: [String(bob.userId)] },
                    },
                  ],
                },
              ],
            },
          },
        },
      });
      // 只包最底層、彼此不互相呼叫的讀取(核心關聯與各 repository 的查詢),數同時進行中的查詢
      let inFlight = 0;
      let maxInFlight = 0;
      const restores: (() => void)[] = [];
      const track = (instance: object, method: string) => {
        const target = instance as Record<string, unknown>;
        const original = target[method] as (
          ...args: unknown[]
        ) => Promise<unknown>;
        target[method] = async (...args: unknown[]) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            // 讓出事件迴圈:若呼叫端平行發出,下一個查詢會在這段時間進來
            await new Promise((resolve) => setTimeout(resolve, 5));
            return await original.apply(instance, args);
          } finally {
            inFlight -= 1;
          }
        };
        restores.push(() => Reflect.deleteProperty(target, method));
      };
      const relations = api.app.get(RelationService, { strict: false });
      track(relations, "listLinks");
      track(relations, "secondIdsOf");
      for (const repository of [
        PermissionsRepository,
        RolesRepository,
        OrgsRepository,
        UsersRepository,
        ModulesRepository,
        FormsRepository,
      ]) {
        const instance = api.app.get(repository, { strict: false });
        track(instance, "findMany");
        track(instance, "findOne");
      }
      const dedupeKey = nextKey("tx02");
      try {
        await transactions.withTransaction(async () => {
          await service.notify(offlineInput(dedupeKey));
        });
      } finally {
        for (const restore of restores) {
          restore();
        }
      }
      expect(maxInFlight).toBe(1);
      expect(await recipientsOf(dedupeKey)).toEqual(
        [String(printerAdmin.userId), String(bob.userId)].toSorted((a, b) =>
          a.localeCompare(b),
        ),
      );
      await ok(api, admin.token, RESET_SETTING, {
        input: { type: PRINTING_AGENT_OFFLINE },
      });
    });

    it("調整與還原都寫稽核", async () => {
      const logs = await api.connection
        .collection("audit_logs")
        .find({
          action: {
            $in: ["notification-settings.edit", "notification-settings.reset"],
          },
        })
        .toArray();
      expect(logs.map((log) => String(log.action))).toEqual(
        expect.arrayContaining([
          "notification-settings.edit",
          "notification-settings.reset",
        ]),
      );
    });

    it("人員條件不合法:所有人 / 所屬組織欄 → VALIDATION_FAILED(AUDIENCE_INVALID);別租戶的人 → OUT_OF_TENANT;當事人通知類型 → UNKNOWN_TYPE", async () => {
      const all = await call(api, admin.token, UPDATE_SETTING, {
        input: { type: PRINTING_AGENT_OFFLINE, audience: { mode: "all" } },
      });
      expect(codeOf(all)).toBe("VALIDATION_FAILED");
      expect(extensionsOf(all)).toMatchObject({ reason: "AUDIENCE_INVALID" });

      const org = await call(api, admin.token, UPDATE_SETTING, {
        input: {
          type: PRINTING_AGENT_OFFLINE,
          audience: {
            mode: "match",
            filter: {
              field: "org",
              cond: "in",
              value: { kind: "static", values: [String(store)] },
              range: "self",
            },
          },
        },
      });
      expect(extensionsOf(org)).toMatchObject({ reason: "AUDIENCE_INVALID" });

      const otherTenant = await createOrg(api.connection, { name: "別的租戶" });
      const outsider = await createOperator(api, api.connection, {
        orgId: otherTenant,
        moduleKeys: [],
        permissionKeys: [],
      });
      const outside = await call(api, admin.token, UPDATE_SETTING, {
        input: {
          type: PRINTING_AGENT_OFFLINE,
          audience: usersAudience(alice.userId, outsider.userId),
        },
      });
      expect(extensionsOf(outside)).toMatchObject({
        code: "VALIDATION_FAILED",
        reason: "OUT_OF_TENANT",
        path: "filter.value.values[1]",
      });

      const party = await call(api, admin.token, UPDATE_SETTING, {
        input: { type: WORKFLOW_RESULT, audience: usersAudience(alice.userId) },
      });
      expect(extensionsOf(party)).toMatchObject({ reason: "UNKNOWN_TYPE" });
    });

    it("沒有權限 → FORBIDDEN;站在根組織改設定 → FORBIDDEN(TENANT_ONLY)", async () => {
      const denied = await call(api, alice.token, NOTIFICATION_SETTINGS, {
        input: {},
      });
      expect(codeOf(denied)).toBe("FORBIDDEN");

      const root = await rootToken(api);
      const rootList = await ok<{
        notificationSettings: { items: SettingRow[] };
      }>(api, root, NOTIFICATION_SETTINGS, { input: {} });
      expect(rootList.notificationSettings.items[0]?.isDefault).toBe(true);
      const rootUpdate = await call(api, root, UPDATE_SETTING, {
        input: {
          type: PRINTING_AGENT_OFFLINE,
          audience: usersAudience(alice.userId),
        },
      });
      expect(extensionsOf(rootUpdate)).toMatchObject({
        code: "FORBIDDEN",
        reason: "TENANT_ONLY",
      });
    });
  });
});
