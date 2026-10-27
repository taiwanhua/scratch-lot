import { useCallback } from "react";
import { useTranslations } from "use-intl";

import type { SidebarBadgeSettingItemFragment } from "@repo/graphql";

import { useAudienceSummary } from "@/components/base/AudiencePicker/useAudienceSummary";

import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";

/**
 * 側欄數字的程式預設登記了 `requires`(權限 key)時,換成人員條件的寫法:摘要與編輯框的起始條件用它
 * (「持有這條權限」;api 的預設判斷用 `holdsPermission`,這裡只是讓使用者看得懂、從它開始改)。
 */
export const requiresAudience = (
  requires: string,
): Record<string, unknown> => ({
  mode: "match",
  filter: {
    op: "AND",
    children: [
      {
        field: "permission",
        cond: "in",
        value: { kind: "static", values: [requires] },
      },
    ],
  },
});

/**
 * 「誰看得到」的一行白話:綁了模組一律是前提(「可進入這個模組的人」),調整過的再加上人員條件摘要
 * (與通知收件人共用 `useAudienceSummary`);沒調整、但程式預設要求權限的,摘要那條權限。
 */
export const useSidebarBadgeAudienceText = (): ((
  row: Pick<SidebarBadgeSettingItemFragment, "audience" | "requires">,
  options?: { asDefault?: boolean },
) => string) => {
  const t = useTranslations("admin.sidebarBadgeSettings");
  const summaryOf = useAudienceSummary(
    NOTIFICATION_AUDIENCE_FIELDS,
    NOTIFICATION_AUDIENCE_ORG_SOURCES,
  );
  return useCallback(
    (row, options = {}) => {
      const audience =
        options.asDefault === true ? null : (row.audience ?? null);
      if (audience !== null) {
        return t("conditionAudience", { condition: summaryOf(audience) });
      }
      if (row.requires) {
        return t("conditionAudience", {
          condition: summaryOf(requiresAudience(row.requires)),
        });
      }
      return t("defaultAudience");
    },
    [summaryOf, t],
  );
};
