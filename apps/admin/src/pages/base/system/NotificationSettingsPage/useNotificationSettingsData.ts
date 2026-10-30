import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";

import {
  type NotificationSettingItemFragment,
  type NotificationSettingsQueryVariables,
  useNotificationSettingsQuery,
} from "@repo/graphql";

import { useIsAtRootOrg } from "@/hooks/base/useIsAtRootOrg";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useNotificationTypesMatchingName } from "@/lib/base/notification-type-name";

import { NOTIFICATION_SETTINGS_PERMISSIONS } from "./notification-settings-permissions";

/** 每頁筆數(api 預設 20;負責人提醒類型通常只有幾種)。 */
export const NOTIFICATION_SETTINGS_PAGE_SIZE = 20;

/** 清單的搜尋與頁碼存在網址 `?list=`(REACT-14);同示範模組列表。 */
const listSchema = z
  .object({
    keyword: z.string().default(""),
    page: z.number().int().min(1).default(1),
  })
  .default({ keyword: "", page: 1 });

/** 以類型 key 找一筆時一次取滿(`keyword` 比對類型 key 的子字串,可能帶出別的類型)。 */
const LOOKUP_PAGE_SIZE = 100;

/** 沒權限 → false;有權限 → 依是否站在根組織(還不知道 = undefined)。 */
const canEditOf = (
  hasEditPermission: boolean,
  isAtRoot: boolean | undefined,
): boolean | undefined => {
  if (!hasEditPermission) {
    return false;
  }
  return isAtRoot === undefined ? undefined : !isAtRoot;
};

/**
 * 通知設定頁的資料層:清單、搜尋 / 頁碼、權限與失效。
 *
 * **能不能改**(`canEdit`)= 有 `system.notification-settings.edit` 且不是站在根組織(`useIsAtRootOrg`:
 * `me.currentOrg.tenantId === null`):根組織沒有自己的通知設定,api 只回預設、改了會 `FORBIDDEN` / `TENANT_ONLY`
 * (`docs/modules/notification-settings.md`「欄位語意」)。有權限但 `me` 還沒載入時是 `undefined`(還不知道):
 * 按鈕先不出現,網址上的 `?edit=` 也先留著,等知道了再決定開不開。
 */
export const useNotificationSettingsData = () => {
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const isAtRoot = useIsAtRootOrg();
  const hasEditPermission = hasPermission(
    NOTIFICATION_SETTINGS_PERMISSIONS.edit,
  );

  const [list, setList] = useUrlState("list", listSchema);
  const { keyword, page } = list;
  const typesMatchingName = useNotificationTypesMatchingName();

  // 搜尋也比對畫面上的顯示名稱(英文介面的名稱只在訊息檔,api 比不到):比中的類型 key 一起送
  const variables = useMemo<NotificationSettingsQueryVariables>(() => {
    const trimmed = keyword.trim();
    return {
      input: {
        keyword: trimmed === "" ? null : trimmed,
        nameMatchedTypes: trimmed === "" ? null : typesMatchingName(trimmed),
        page,
        pageSize: NOTIFICATION_SETTINGS_PAGE_SIZE,
      },
    };
  }, [keyword, page, typesMatchingName]);
  const settings = useNotificationSettingsQuery(session.client, variables);

  const rows: readonly NotificationSettingItemFragment[] =
    settings.data?.notificationSettings.items ?? [];
  const totalCount = settings.data?.notificationSettings.totalCount ?? 0;

  /** 換關鍵字回到第一頁(否則會停在一個不存在的頁碼上看到空清單)。 */
  const setKeyword = (value: string) => {
    setList((current) => ({ ...current, keyword: value, page: 1 }));
  };
  const setPage = (value: number) => {
    setList((current) => ({ ...current, page: value }));
  };

  /** 改 / 還原後失效所有通知設定清單(目前這頁 + 編輯彈窗以類型查的那一份;DATA-02 / 04)。 */
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: useNotificationSettingsQuery.getKey(variables).slice(0, 1),
    });
  };

  return {
    canEdit: canEditOf(hasEditPermission, isAtRoot),
    isAtRoot: isAtRoot === true,
    keyword,
    setKeyword,
    page,
    setPage,
    rows,
    totalCount,
    isLoading: settings.isLoading,
    isError: settings.isError,
    invalidate,
  };
};

/**
 * 網址 `?edit=<類型 key>` 指到的那一筆(REACT-14 編輯彈窗):以類型 key 當關鍵字查、再挑出完全相同的那一筆
 * (不靠目前這一頁的清單,換頁或搜尋過也打得開)。查完找不到 = `isMissing`。
 */
export const useNotificationSettingByType = (
  type: string | null,
  isEnabled: boolean,
) => {
  const { session } = useSession();
  const query = useNotificationSettingsQuery(
    session.client,
    { input: { keyword: type ?? "", page: 1, pageSize: LOOKUP_PAGE_SIZE } },
    { enabled: type !== null && isEnabled, retry: false },
  );
  const setting =
    query.data?.notificationSettings.items.find((item) => item.type === type) ??
    null;
  return {
    setting,
    isMissing: query.isError || (query.isSuccess && setting === null),
  };
};
