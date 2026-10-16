import { useTranslations } from "use-intl";

import type { NotificationSettingItemFragment } from "@repo/graphql";

/**
 * 組織範圍(類型宣告、唯讀)→ 一行白話:`ref`(觸發事件的組織 / 最上層組織)+ `range`(本身 / 含下層 / 含上層)。
 * 文案是一個 ICU select(`admin.notificationSettings.orgScope`);認不得的值落在 `other`。
 */
export const useOrgScopeText = (): ((
  scope: NotificationSettingItemFragment["orgScope"],
) => string) => {
  const t = useTranslations("admin.notificationSettings");
  return (scope) => t("orgScope", { origin: scope.ref, range: scope.range });
};
