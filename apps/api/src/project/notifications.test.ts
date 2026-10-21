import { describe, expect, it } from "@jest/globals";

import { PRINTING_AGENT_OFFLINE } from "../notifications/base-notification-types";
import type { NotificationOrgScope } from "../notifications/notification-registry";
import { composeAllNotificationTypes } from "../notifications/notification-registry.module";
import { PROJECT_NOTIFICATIONS, STORE_MANAGER_AUDIENCE } from "./notifications";

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
];

describe("專案通知類型(專案規格 3.4)", () => {
  it("十一種類型逐列與 3.4 一致(加調貨送錯分店):key、名稱、類別、組織範圍、預設人員條件", () => {
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
});
