import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import {
  BASE_NOTIFICATION_LINKS,
  PRINTING_AGENT_OFFLINE,
} from "../notifications/base-notification-types";
import {
  type NotificationOrgScope,
  composeNotificationLinks,
  notificationLinkOf,
} from "../notifications/notification-registry";
import { composeAllNotificationTypes } from "../notifications/notification-registry.module";
import {
  PROJECT_NOTIFICATIONS,
  SCHEDULE_DAY_OFF_OVERRIDDEN,
  SCHEDULE_MY_DAY_OFFS_REF,
  SCHEDULE_MY_SCHEDULE_REF,
  STORE_MANAGER_AUDIENCE,
} from "./notifications";

const permissionAudience = (key: string) => ({
  mode: "match",
  filter: {
    field: "permission",
    cond: "in",
    value: { kind: "static", values: [key] },
  },
});

const STORE_MANAGER = permissionAudience("store.bank-deposit");
const BRANCH_SELF: NotificationOrgScope = { ref: "event-org", range: "self" };
const BRANCH_AND_ABOVE: NotificationOrgScope = {
  ref: "event-org",
  range: "ancestors",
};
const TENANT: NotificationOrgScope = { ref: "tenant", range: "self" };

/**
 * 專案規格 3.4 逐列:key、名稱、類別、組織範圍、預設人員條件。
 * 「角色 店長」以持有 `store.bank-deposit` 表示(3.3:店長有、店員沒有;角色是各租戶開通時建的,類型宣告寫不了角色 id)。
 */
const EXPECTED = [
  {
    key: "lottery.daily-close-overdue",
    name: "日結逾期",
    category: "responsible",
    orgScope: BRANCH_SELF,
    defaultAudience: STORE_MANAGER,
  },
  {
    key: "lottery.transfer-shipped",
    name: "調貨出貨通知",
    category: "responsible",
    orgScope: BRANCH_SELF,
    defaultAudience: STORE_MANAGER,
  },
  {
    key: "lottery.license-expiring",
    name: "證照到期",
    category: "responsible",
    orgScope: BRANCH_AND_ABOVE,
    defaultAudience: STORE_MANAGER,
  },
  {
    key: "lottery.store-rent-due",
    name: "牌租繳費提醒",
    category: "responsible",
    orgScope: BRANCH_AND_ABOVE,
    defaultAudience: STORE_MANAGER,
  },
  {
    key: "lottery.period-close-overdue",
    name: "關帳逾期",
    category: "responsible",
    orgScope: TENANT,
    defaultAudience: permissionAudience("accounts.close-period"),
  },
  {
    key: "lottery.purchase-wrong-store",
    name: "進貨送錯分店",
    category: "party",
  },
  {
    key: "lottery.transfer-wrong-store",
    name: "調貨送錯分店",
    category: "party",
  },
  { key: "schedule.day-off-open", name: "畫休開放", category: "party" },
  { key: "schedule.day-off-closing", name: "畫休即將截止", category: "party" },
  { key: "schedule.published", name: "排班發布", category: "party" },
  { key: "schedule.changed", name: "排班異動", category: "party" },
  {
    key: "schedule.day-off-overridden",
    name: "畫休被代改",
    category: "party",
  },
];

describe("專案通知類型(專案規格 3.4)", () => {
  it("十二種類型逐列與 3.4 一致(加調貨送錯分店、畫休被代改):key、名稱、類別、組織範圍、預設人員條件", () => {
    expect(
      PROJECT_NOTIFICATIONS.types.map(
        ({ key, name, category, orgScope, defaultAudience }) => ({
          key,
          name,
          category,
          ...(orgScope && { orgScope }),
          ...(defaultAudience && { defaultAudience }),
        }),
      ),
    ).toEqual(EXPECTED);
    expect(STORE_MANAGER_AUDIENCE).toEqual(STORE_MANAGER);
  });

  it("與底座合成不撞、格式合法(app 起得來)", () => {
    expect(() =>
      composeAllNotificationTypes(PROJECT_NOTIFICATIONS),
    ).not.toThrow();
  });

  it("通知設定頁列出的負責人提醒 = 底座的列印代理程式離線 + 專案五種(當事人通知不列)", () => {
    const listed = [
      ...composeAllNotificationTypes(PROJECT_NOTIFICATIONS).values(),
    ]
      .filter((type) => type.category === "responsible")
      .map((type) => type.key);
    expect(listed).toEqual([
      PRINTING_AGENT_OFFLINE,
      "lottery.daily-close-overdue",
      "lottery.transfer-shipped",
      "lottery.license-expiring",
      "lottery.store-rent-due",
      "lottery.period-close-overdue",
    ]);
  });

  it("每種類型都有繁中與英文範本,參數缺漏時也產生非空的標題與內容", () => {
    for (const type of PROJECT_NOTIFICATIONS.types) {
      expect(
        Object.keys(type.template).toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(["en", "zh-TW"]);
      for (const template of Object.values(type.template)) {
        const content = template({});
        expect(content.title.trim()).not.toBe("");
        expect(content.body.trim()).not.toBe("");
      }
    }
  });

  it("範本代入參數(證照到期:到期當天與到期前 N 天的說法不同)", () => {
    const license = PROJECT_NOTIFICATIONS.types.find(
      (type) => type.key === "lottery.license-expiring",
    );
    const zh = license?.template["zh-TW"];
    expect(
      zh?.({
        dealerType: "乙類",
        dealerName: "王小明",
        expiresOn: "2026-12-31",
        daysLeft: "30",
      }),
    ).toEqual({
      title: "證照到期:王小明",
      body: "乙類「王小明」的證照將於 2026-12-31 到期(還有 30 天)。",
    });
    expect(
      zh?.({
        dealerType: "乙類",
        dealerName: "王小明",
        expiresOn: "2026-12-31",
        daysLeft: "0",
      }).body,
    ).toBe("乙類「王小明」的證照今天(2026-12-31)到期。");
  });

  it("畫休被代改:新增 / 刪除兩種說法;時段逐段列出、整天畫休不列時段;原因選填", () => {
    const type = PROJECT_NOTIFICATIONS.types.find(
      (item) => item.key === SCHEDULE_DAY_OFF_OVERRIDDEN,
    );
    const base = {
      orgName: "中山店",
      date: "2027-04-06",
      byName: "李店長",
    };
    expect(
      type?.template["zh-TW"]?.({
        ...base,
        action: "add",
        kind: "time-range",
        slots: "09:00–12:00,14:00–18:00",
        reason: "其他(支援活動)",
      }),
    ).toEqual({
      title: "畫休被代改:2027-04-06",
      body: "李店長 在「中山店」替你登記了 2027-04-06 的時段不可排(09:00–12:00、14:00–18:00)。原因:其他(支援活動)",
    });
    expect(
      type?.template["zh-TW"]?.({
        ...base,
        action: "delete",
        kind: "full-day",
        slots: "",
        reason: null,
      }).body,
    ).toBe("李店長 在「中山店」刪除了你 2027-04-06 的整天畫休。");
    expect(
      type?.template.en?.({
        ...base,
        action: "add",
        kind: "time-range",
        slots: "09:00–12:00,14:00–18:00",
        reason: null,
      }).body,
    ).toBe(
      '李店長 registered a day off for you on 2027-04-06 at "中山店": unavailable hours (09:00–12:00, 14:00–18:00).',
    );
  });
});

describe("專案通知連結", () => {
  const links = composeNotificationLinks(
    BASE_NOTIFICATION_LINKS,
    PROJECT_NOTIFICATIONS.links,
  );

  it("與底座合成不撞、格式合法", () => {
    expect([...links.keys()]).toEqual(
      expect.arrayContaining([
        "lottery-purchase",
        "lottery-transfer",
        "lottery-dealer",
        "lottery-store-board",
        "lottery-accounts-tab",
        SCHEDULE_MY_SCHEDULE_REF,
        SCHEDULE_MY_DAY_OFFS_REF,
      ]),
    );
  });

  it("負責人提醒點進去:調貨單詳情、經銷商詳情、那家店的看板、帳戶管理的關帳分頁", () => {
    expect(notificationLinkOf(links, "lottery-transfer", "t1")).toBe(
      "/purchasing/transfer/view-page/t1",
    );
    expect(notificationLinkOf(links, "lottery-dealer", "d1")).toBe(
      "/dealers/view-page/d1",
    );
    expect(notificationLinkOf(links, "lottery-store-board", "o1")).toBe(
      "/store?tab=board&org=o1",
    );
    expect(notificationLinkOf(links, "lottery-accounts-tab", "close")).toBe(
      "/accounts?tab=close",
    );
  });

  it("排班通知點進去 = 我的班表的分頁與月份(refId = 月份)", () => {
    expect(notificationLinkOf(links, SCHEDULE_MY_SCHEDULE_REF, "2027-05")).toBe(
      "/schedule/my?tab=schedule&month=2027-05",
    );
    expect(notificationLinkOf(links, SCHEDULE_MY_DAY_OFFS_REF, "2026-12")).toBe(
      "/schedule/my?tab=day-offs&month=2026-12",
    );
  });
});

/** `notifications.<group>.<類型 key 的各段>`;不是字串 → null。 */
const textOf = (
  messages: unknown,
  group: string,
  typeKey: string,
): string | null => {
  let node: unknown = messages;
  for (const segment of ["notifications", group, ...typeKey.split(".")]) {
    node =
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[segment]
        : undefined;
  }
  return typeof node === "string" && node.trim() !== "" ? node : null;
};

/** 字典某一組底下所有字串葉的類型 key(巢狀層級以 `.` 接回)。 */
const messageKeysOf = (node: unknown, prefix: string): string[] =>
  typeof node === "object" && node !== null
    ? Object.entries(node).flatMap(([segment, child]) =>
        messageKeysOf(child, prefix === "" ? segment : `${prefix}.${segment}`),
      )
    : [prefix];

/**
 * 後台介面的類型名稱、收件人說明、日期稱呼走訊息檔 `admin.notifications.<types|recipientNotes|scheduleDateLabels>.<類型 key>`
 * (`apps/admin/src/lib/base/notification-type-name.ts`;沒有就退回登記的繁中)。專案的寫在
 * `packages/i18n/messages/<語系>/project/admin.json`:每種登記的類型兩種語系都要有,防新增類型時漏掉、英文介面顯示繁中。
 */
describe("專案通知類型的介面文案(兩種語系)", () => {
  const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
  const messagesOf = (locale: string): unknown =>
    JSON.parse(
      readFileSync(
        path.join(
          REPO_ROOT,
          "packages/i18n/messages",
          locale,
          "project/admin.json",
        ),
        "utf8",
      ),
    );
  const LOCALES = { zh: messagesOf("zh-TW"), en: messagesOf("en") };

  it.each(PROJECT_NOTIFICATIONS.types.map((type) => [type.key, type] as const))(
    "%s:類型名稱有繁中(= 登記的名稱)與英文",
    (_key, type) => {
      expect(textOf(LOCALES.zh, "types", type.key)).toBe(type.name);
      expect(textOf(LOCALES.en, "types", type.key)).not.toBeNull();
    },
  );

  it("有收件人說明 / 日期稱呼的類型,兩種語系都有(繁中 = 登記的值)", () => {
    for (const type of PROJECT_NOTIFICATIONS.types) {
      if (type.recipientNote !== undefined) {
        expect(textOf(LOCALES.zh, "recipientNotes", type.key)).toBe(
          type.recipientNote,
        );
        expect(textOf(LOCALES.en, "recipientNotes", type.key)).not.toBeNull();
      }
      if (type.schedule?.dateLabel !== undefined) {
        expect(textOf(LOCALES.zh, "scheduleDateLabels", type.key)).toBe(
          type.schedule.dateLabel,
        );
        expect(
          textOf(LOCALES.en, "scheduleDateLabels", type.key),
        ).not.toBeNull();
      }
    }
  });

  it("專案字典沒有登記表以外的類型(改名 / 移除類型時一起刪)", () => {
    const registered = new Set(
      PROJECT_NOTIFICATIONS.types.map((type) => type.key),
    );
    for (const messages of Object.values(LOCALES)) {
      const groups = (messages as { notifications?: Record<string, unknown> })
        .notifications;
      for (const group of Object.values(groups ?? {})) {
        for (const key of messageKeysOf(group, "")) {
          expect(registered.has(key) ? key : `未登記:${key}`).toBe(key);
        }
      }
    }
  });
});
