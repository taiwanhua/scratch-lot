import { HttpResponse } from "msw";

import type {
  ResetSidebarBadgeSettingMutationVariables,
  SidebarBadgeSettingItemFragment,
  UpdateSidebarBadgeSettingMutationVariables,
} from "@repo/graphql";

import { type AuthErrorCode, graphqlError } from "./auth-handlers";
import { api } from "./server";

/** 通知設定頁「側欄數字」區塊的一列(程式登記 + 租戶有開通);`audience` 是租戶調整過的,null = 程式預設。 */
export interface TestSidebarBadge {
  moduleKey: string;
  moduleName: string;
  descriptionKey?: string | null;
  requires?: string | null;
  audience?: Record<string, unknown> | null;
}

export interface SidebarBadgeSettingsFailure {
  code: string;
  extensions?: Record<string, unknown>;
}

const TIMESTAMP = "2026-10-17T03:00:00.000Z";
const OPERATOR_ID = "user-admin";

const fail = (code: string, extensions: Record<string, unknown> = {}) =>
  graphqlError(code as AuthErrorCode, code, extensions);

/**
 * 通知設定頁「側欄數字」區塊的假 api(`sidebarBadgeSettings` / `updateSidebarBadgeSetting` /
 * `resetSidebarBadgeSetting`;正本 `apps/api/src/sidebar-badges/sidebar-badge-settings.service.ts`)。
 * 有狀態(TEST-08):改了或還原後重查拿到新值;由 `notificationSettingsWorld` 一起掛上。
 */
export const sidebarBadgeSettingsHandlers = ({
  badges,
  inputs,
  failures,
}: {
  badges: readonly TestSidebarBadge[];
  inputs: {
    badgeUpdate: UpdateSidebarBadgeSettingMutationVariables["input"][];
    badgeReset: ResetSidebarBadgeSettingMutationVariables["input"][];
  };
  failures: {
    update?: SidebarBadgeSettingsFailure;
    reset?: SidebarBadgeSettingsFailure;
  };
}) => {
  const audiences = new Map(
    badges.map((badge) => [badge.moduleKey, badge.audience ?? null]),
  );
  const toItem = (badge: TestSidebarBadge): SidebarBadgeSettingItemFragment => {
    const audience = audiences.get(badge.moduleKey) ?? null;
    return {
      moduleKey: badge.moduleKey,
      moduleName: badge.moduleName,
      descriptionKey: badge.descriptionKey ?? null,
      requires: badge.requires ?? null,
      audience,
      isDefault: audience === null,
      updatedAt: audience === null ? null : TIMESTAMP,
      updatedBy: audience === null ? null : OPERATOR_ID,
    };
  };
  const find = (moduleKey: string) =>
    badges.find((item) => item.moduleKey === moduleKey);

  return [
    api.query("SidebarBadgeSettings", () =>
      HttpResponse.json({
        data: {
          sidebarBadgeSettings: {
            items: badges.map((badge) => toItem(badge)),
            totalCount: badges.length,
          },
        },
      }),
    ),
    api.mutation("UpdateSidebarBadgeSetting", ({ variables }) => {
      const { input } = variables as UpdateSidebarBadgeSettingMutationVariables;
      inputs.badgeUpdate.push(input);
      if (failures.update !== undefined) {
        return fail(failures.update.code, failures.update.extensions ?? {});
      }
      const badge = find(input.moduleKey);
      if (badge === undefined) {
        return fail("VALIDATION_FAILED", { reason: "UNKNOWN_BADGE" });
      }
      audiences.set(badge.moduleKey, input.audience);
      return HttpResponse.json({
        data: { updateSidebarBadgeSetting: { setting: toItem(badge) } },
      });
    }),
    api.mutation("ResetSidebarBadgeSetting", ({ variables }) => {
      const { input } = variables as ResetSidebarBadgeSettingMutationVariables;
      inputs.badgeReset.push(input);
      if (failures.reset !== undefined) {
        return fail(failures.reset.code, failures.reset.extensions ?? {});
      }
      const badge = find(input.moduleKey);
      if (badge === undefined) {
        return fail("VALIDATION_FAILED", { reason: "UNKNOWN_BADGE" });
      }
      audiences.set(badge.moduleKey, null);
      return HttpResponse.json({
        data: { resetSidebarBadgeSetting: { setting: toItem(badge) } },
      });
    }),
  ];
};

/**
 * 「側欄數字」區塊的兩列:申請中心(程式預設要求 `apply-center.view`、有說明文字)
 * 與一個沒填 requires / 說明的示範模組。
 */
export const sidebarBadges = (
  overrides: Partial<Record<string, Partial<TestSidebarBadge>>> = {},
): TestSidebarBadge[] => [
  {
    moduleKey: "apply-center",
    moduleName: "申請中心",
    descriptionKey: "admin.sidebarBadgeSettings.descriptions.apply-center",
    requires: "apply-center.view",
    ...overrides["apply-center"],
  },
  {
    moduleKey: "demo.orders",
    moduleName: "訂單",
    ...overrides["demo.orders"],
  },
];
