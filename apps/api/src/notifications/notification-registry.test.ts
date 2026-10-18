import { describe, expect, it } from "@jest/globals";

import { composeUserPreferences } from "../user-preferences/user-preference-registry";
import {
  BASE_NOTIFICATION_LINKS,
  BASE_NOTIFICATION_TYPES,
  PRINTING_AGENT_OFFLINE,
  WORKFLOW_RESULT,
  WORKFLOW_TASK_CREATED,
} from "./base-notification-types";
import {
  NOTIFICATION_CHANNELS,
  NotificationRegistryError,
  type NotificationTypeDefinition,
  composeNotificationLinks,
  composeNotificationTypes,
  notificationLinkOf,
  notificationPreferenceDefinitions,
  notificationPreferenceKey,
  templateFor,
} from "./notification-registry";

const PARTY: NotificationTypeDefinition = {
  key: "demo.stock-low",
  name: "庫存不足",
  defaultChannels: ["in-app"],
  canDisable: { "in-app": true },
  category: "party",
  template: {
    "zh-TW": (params) => ({ title: `庫存不足:${params.item ?? ""}`, body: "" }),
  },
};

const compose = (type: NotificationTypeDefinition) => () =>
  composeNotificationTypes([], [type]);

describe("通知類型登記表", () => {
  it("底座本輪登記 6 種(2026-10-16 定),負責人提醒只有 printing.agent-offline", () => {
    const registry = composeNotificationTypes(BASE_NOTIFICATION_TYPES, []);
    expect([...registry.keys()]).toEqual([
      "workflow.task-created",
      "workflow.result",
      "workflow.overdue",
      "workflow.cc",
      "printing.job-failed",
      "printing.agent-offline",
    ]);
    expect(
      [...registry.values()]
        .filter((type) => type.category === "responsible")
        .map((type) => type.key),
    ).toEqual([PRINTING_AGENT_OFFLINE]);
    expect(registry.get(WORKFLOW_TASK_CREATED)?.canDisable).toEqual({
      "in-app": false,
      email: true,
    });
  });

  it("專案可以追加類型;key 與底座重複 → 起不來", () => {
    const registry = composeNotificationTypes(BASE_NOTIFICATION_TYPES, [PARTY]);
    expect(registry.get(PARTY.key)).toBe(PARTY);
    expect(() =>
      composeNotificationTypes(BASE_NOTIFICATION_TYPES, [
        { ...PARTY, key: WORKFLOW_RESULT },
      ]),
    ).toThrow(NotificationRegistryError);
  });

  it.each([
    ["key 只有一段", { key: "stock" }],
    ["key 有底線", { key: "demo.stock_low" }],
    ["key 有大寫", { key: "demo.StockLow" }],
    ["沒有管道", { defaultChannels: [], canDisable: {} }],
    ["沒登記的管道", { defaultChannels: ["sms"], canDisable: { sms: true } }],
    [
      "canDisable 沒逐一宣告",
      { defaultChannels: ["in-app", "email"], canDisable: { "in-app": true } },
    ],
    ["沒有繁中範本", { template: { en: PARTY.template["zh-TW"] } }],
    [
      "當事人通知宣告了組織範圍",
      { orgScope: { ref: "event-org", range: "self" } },
    ],
    ["負責人提醒沒有組織範圍與預設條件", { category: "responsible" }],
  ] as const)("%s → 起不來", (_label, patch) => {
    expect(
      compose({ ...PARTY, ...patch } as NotificationTypeDefinition),
    ).toThrow(NotificationRegistryError);
  });

  it("負責人提醒的預設條件不能是所有人、不能用所屬組織欄", () => {
    const responsible = {
      ...PARTY,
      category: "responsible",
      orgScope: { ref: "event-org", range: "self" },
    } as const;
    expect(
      compose({ ...responsible, defaultAudience: { mode: "all" } }),
    ).toThrow("defaultAudience");
    expect(
      compose({
        ...responsible,
        defaultAudience: {
          mode: "match",
          filter: {
            field: "org",
            cond: "in",
            value: { kind: "dynamic", ref: "event-org" },
            range: "self",
          },
        },
      }),
    ).toThrow("defaultAudience");
  });
});

describe("通知管道開關的偏好 key(規格 10.6)", () => {
  it("編碼:notification_<類型的 . 換成 _>_<管道>,符合偏好 key 的格式", () => {
    expect(notificationPreferenceKey(WORKFLOW_TASK_CREATED, "in-app")).toBe(
      "notification_workflow_task-created_in-app",
    );
    expect(notificationPreferenceKey("demo.expiry-reminder", "email")).toBe(
      "notification_demo_expiry-reminder_email",
    );
  });

  it("可還原:以 _ 切開 = 前綴 + 類型的各段 + 管道(類型與管道 key 都不含 _)", () => {
    const registry = composeNotificationTypes(BASE_NOTIFICATION_TYPES, [PARTY]);
    const seen = new Set<string>();
    for (const type of registry.values()) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const key = notificationPreferenceKey(type.key, channel);
        const [prefix, ...rest] = key.split("_");
        expect(prefix).toBe("notification");
        expect(rest.at(-1)).toBe(channel);
        expect(rest.slice(0, -1).join(".")).toBe(type.key);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("每種類型的每個 defaultChannels 一個布林開關,預設開;canDisable 為否的只收 true", () => {
    const registry = composeNotificationTypes(BASE_NOTIFICATION_TYPES, []);
    const definitions = notificationPreferenceDefinitions(registry);
    expect(definitions).toHaveLength(9);
    const locked = definitions.find(
      (definition) =>
        definition.key ===
        notificationPreferenceKey(WORKFLOW_TASK_CREATED, "in-app"),
    );
    expect(locked).toEqual({
      key: "notification_workflow_task-created_in-app",
      type: "boolean",
      defaultValue: true,
      allowedValues: [true],
    });
    const email = definitions.find(
      (definition) =>
        definition.key === notificationPreferenceKey(WORKFLOW_RESULT, "email"),
    );
    expect(email).toEqual({
      key: "notification_workflow_result_email",
      type: "boolean",
      defaultValue: true,
    });
    // 與手寫的偏好登記合成不會撞 key、也通過 key 格式檢查
    expect(() => composeUserPreferences([], [], definitions)).not.toThrow();
  });
});

describe("範本與連結", () => {
  it("依收件人的語言挑範本:完全相同 → 同語言 → 繁中", () => {
    const registry = composeNotificationTypes(BASE_NOTIFICATION_TYPES, []);
    const type = registry.get(WORKFLOW_RESULT);
    if (type === undefined) {
      throw new Error("沒有 workflow.result");
    }
    const params = {
      subject: "請假單",
      result: "rejected",
      comment: "日期重疊",
    };
    expect(templateFor(type, "zh-TW")(params)).toEqual({
      title: "申請已駁回:請假單",
      body: "您的申請「請假單」已駁回。理由:日期重疊",
    });
    expect(templateFor(type, "en-US")(params).title).toBe(
      "Request rejected: 請假單",
    );
    expect(templateFor(type, "ja")(params).title).toBe("申請已駁回:請假單");
    expect(
      templateFor(type, null)({ ...params, result: "approved", comment: null }),
    ).toEqual({
      title: "申請已核准:請假單",
      body: "您的申請「請假單」已核准。",
    });
  });

  it("連結登記:refType → 站內路徑;沒登記或沒有 ref → null", () => {
    const links = composeNotificationLinks(BASE_NOTIFICATION_LINKS, []);
    expect(notificationLinkOf(links, "workflow-instance", "abc")).toBe(
      "/apply-center/view-page/abc",
    );
    expect(notificationLinkOf(links, "unknown", "abc")).toBeNull();
    expect(notificationLinkOf(links, null, null)).toBeNull();
  });

  it.each([
    [{ refType: "Bad_Type", path: "/x/{refId}" }],
    [{ refType: "thing", path: "x/{refId}" }],
    [{ refType: "thing", path: "/x" }],
    [{ refType: "workflow-instance", path: "/dup/{refId}" }],
  ])("連結登記不合格式或重複 → 起不來(%j)", (link) => {
    expect(() =>
      composeNotificationLinks(BASE_NOTIFICATION_LINKS, [link]),
    ).toThrow(NotificationRegistryError);
  });
});
