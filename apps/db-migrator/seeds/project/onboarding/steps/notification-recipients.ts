import { type OnboardingStep, requireRoleId } from "../context";

/**
 * 規格 3.4 預設收件人是「角色 店長」的四種負責人提醒。類型宣告(`apps/api/src/project/notifications.ts`)
 * 寫不了角色 id(每個租戶不同),預設用「持有 `store.bank-deposit`」;開通時建好角色後改成角色 店長。
 */
export const STORE_MANAGER_NOTIFICATION_TYPES = [
  "lottery.daily-close-overdue",
  "lottery.transfer-shipped",
  "lottery.license-expiring",
  "lottery.store-rent-due",
] as const;

const SETTINGS = /* GraphQL */ `
  query OnboardingNotificationSettings($input: NotificationSettingsInput!) {
    notificationSettings(input: $input) {
      items {
        type
        name
        isDefault
      }
    }
  }
`;

const UPDATE_SETTING = /* GraphQL */ `
  mutation OnboardingUpdateNotificationSetting(
    $input: UpdateNotificationSettingInput!
  ) {
    updateNotificationSetting(input: $input) {
      setting {
        type
        isDefault
      }
    }
  }
`;

/** 人員條件「角色 店長」(只送收件人,提醒時間不動)。 */
export function storeManagerAudience(roleId: string): Record<string, unknown> {
  return {
    mode: "match",
    filter: {
      field: "role",
      cond: "in",
      value: { kind: "static", values: [roleId] },
    },
  };
}

/**
 * 開通清單第 12 點裡自動的部分:四種通知的收件人改成角色 店長(用「角色」步驟取得的 id)。
 * 只改還是預設值的;租戶已調整過(含之前開通時改成店長的)一律不動。
 */
export const notificationRecipientsStep: OnboardingStep = {
  key: "notification-recipients",
  title: "通知收件人",
  run: async ({ client, state }) => {
    const roleId = requireRoleId(state, "store-manager");
    const { notificationSettings } = await client.request<{
      notificationSettings: {
        items: { type: string; name: string; isDefault: boolean }[];
      };
    }>(SETTINGS, { input: { pageSize: 100 } });
    const byType = new Map(
      notificationSettings.items.map((item) => [item.type, item]),
    );
    const lines: string[] = [];
    for (const type of STORE_MANAGER_NOTIFICATION_TYPES) {
      const setting = byType.get(type);
      if (setting === undefined) {
        throw new Error(`通知設定裡沒有「${type}」這個類型`);
      }
      if (!setting.isDefault) {
        lines.push(`「${setting.name}」租戶已調整過收件人,不動`);
        continue;
      }
      await client.request(UPDATE_SETTING, {
        input: { type, audience: storeManagerAudience(roleId) },
      });
      lines.push(`「${setting.name}」收件人改成角色 店長`);
    }
    return lines;
  },
};
