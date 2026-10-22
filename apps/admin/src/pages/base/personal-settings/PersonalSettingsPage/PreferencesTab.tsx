import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type MyNotificationPreferencesQuery,
  type MyPreferencesQuery,
  type UpdateMyPreferencesMutation,
  useMyNotificationPreferencesQuery,
  useMyPreferencesQuery,
  useUpdateMyPreferencesMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUnsavedGuard } from "@/hooks/base/useUnsavedGuard";
import { useNotificationTypeName } from "@/lib/base/notification-type-name";

type TypePreference =
  MyNotificationPreferencesQuery["myNotificationPreferences"]["items"][number];

/** 管道欄寬(px;Figma 的「站內通知」「Email」欄)。 */
const CHANNEL_COLUMN_WIDTH = 200;

/** 各類型出現過的管道,依第一次出現的順序(底座:站內通知、Email;專案登記的新管道排在後面)。 */
const channelsOf = (items: readonly TypePreference[]): string[] => {
  const channels: string[] = [];
  for (const item of items) {
    for (const entry of item.channels) {
      if (!channels.includes(entry.channel)) {
        channels.push(entry.channel);
      }
    }
  }
  return channels;
};

/** 記下一個開關的變動;改回原值就不算變動(從草稿拿掉)。 */
const withChange = (
  draft: Readonly<Record<string, boolean>>,
  key: string,
  next: boolean,
  original: boolean,
): Record<string, boolean> => {
  const rest = Object.fromEntries(
    Object.entries(draft).filter(([existing]) => existing !== key),
  );
  return next === original ? rest : { ...rest, [key]: next };
};

/** 寫入後的偏好(`updateMyPreferences.settings`)套回開關快取:有該 key 的管道改成 `!== false`。 */
const withSettings = (
  current: MyNotificationPreferencesQuery,
  settings: Record<string, unknown>,
): MyNotificationPreferencesQuery => ({
  myNotificationPreferences: {
    ...current.myNotificationPreferences,
    items: current.myNotificationPreferences.items.map((item) => ({
      ...item,
      channels: item.channels.map((entry) =>
        entry.preferenceKey in settings
          ? { ...entry, enabled: settings[entry.preferenceKey] !== false }
          : entry,
      ),
    })),
  },
});

/**
 * 「偏好」分頁(通知管道開關的個人層,`docs/modules/notification-settings.md`「個人偏好的管道開關」):
 * 每種通知類型一列、每個管道一欄的開關,只對類型的 `defaultChannels` 給開關(沒有的管道那格空白,
 * 使用者不能自行打開類型預設沒有的管道)。`canDisable = false` 的管道開關停用(api 也會擋)。
 * 改完按「儲存」一次寫入有變動的偏好 key(`updateMyPreferences`,key 由 api 給的 `preferenceKey`)。
 *
 * 語言不在這裡(只放頭像選單);顯示密度不做。
 * 類型名稱經 `useNotificationTypeName`(訊息檔 `admin.notifications.types.<key>`,沒有退回 api 的 `name`)。
 */
export const PreferencesTab = () => {
  const t = useTranslations("admin.notifications.preferences");
  const tSettings = useTranslations("admin.personalSettings");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const typeName = useNotificationTypeName();
  const query = useMyNotificationPreferencesQuery(session.client);
  /** 尚未儲存的變動:偏好 key → 開 / 關 */
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  const items = useMemo(
    () => query.data?.myNotificationPreferences.items ?? [],
    [query.data],
  );
  const channels = useMemo(() => channelsOf(items), [items]);

  const save = useUpdateMyPreferencesMutation(
    session.client,
    useMutationFeedback<UpdateMyPreferencesMutation>({
      success: t("saved"),
      error: () => t("saveFailed"),
      onSuccess: (payload) => {
        const { settings } = payload.updateMyPreferences;
        // DATA-04 (a):先用回傳的偏好改寫開關快取,再清草稿 —— 清草稿時開關讀的已經是新值,不會閃回舊值
        queryClient.setQueryData<MyNotificationPreferencesQuery>(
          useMyNotificationPreferencesQuery.getKey(),
          (current) =>
            current === undefined ? current : withSettings(current, settings),
        );
        setDraft({});
        // 我的偏好快取(語言也在裡面)換成寫入後的值;(b) 管道開關仍重抓一次
        queryClient.setQueryData<MyPreferencesQuery>(
          useMyPreferencesQuery.getKey(),
          (current) =>
            current === undefined
              ? current
              : {
                  myPreferences: {
                    ...current.myPreferences,
                    settings: payload.updateMyPreferences.settings,
                  },
                },
        );
        void queryClient.invalidateQueries({
          queryKey: useMyNotificationPreferencesQuery.getKey(),
        });
      },
    }),
  );

  const hasChanges = Object.keys(draft).length > 0;
  // 有未存的開關變動時,關分頁 / 重新整理先由瀏覽器問一次(同權限矩陣)
  useUnsavedGuard(hasChanges);

  const toggle = (key: string, next: boolean, original: boolean) => {
    setDraft((current) => withChange(current, key, next, original));
  };

  const channelLabel = (channel: string) =>
    t.has(`channels.${channel}`) ? t(`channels.${channel}`) : channel;

  const columns: TableColumn<TypePreference>[] = [
    {
      key: "type",
      header: t("type"),
      isEmphasized: true,
      render: (row) => typeName(row.type, row.name),
    },
    ...channels.map((channel): TableColumn<TypePreference> => ({
      key: channel,
      header: channelLabel(channel),
      width: CHANNEL_COLUMN_WIDTH,
      render: (row) => {
        const entry = row.channels.find((item) => item.channel === channel);
        if (entry === undefined) {
          return null;
        }
        const checked = draft[entry.preferenceKey] ?? entry.enabled;
        return (
          <Switch
            checked={checked}
            disabled={!entry.canDisable || save.isPending}
            onChange={(_event, next) => {
              toggle(entry.preferenceKey, next, entry.enabled);
            }}
            slotProps={{
              input: {
                "aria-label": t("channelSwitch", {
                  type: typeName(row.type, row.name),
                  channel: channelLabel(channel),
                }),
                title: entry.canDisable ? undefined : t("locked"),
              },
            }}
          />
        );
      },
    })),
  ];

  if (query.isError) {
    return <Alert severity="error">{t("loadFailed")}</Alert>;
  }
  if (query.isSuccess && items.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        {tSettings("preferencesEmpty")}
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
        {t("heading")}
      </Typography>
      <Table
        aria-label={t("heading")}
        columns={columns}
        rows={items}
        getRowKey={(row) => row.type}
        isLoading={query.isPending}
        size="small"
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="contained"
          disabled={!hasChanges || save.isPending}
          onClick={() => {
            save.mutate({ input: { settings: draft } });
          }}
        >
          {t("save")}
        </Button>
      </Box>
    </Stack>
  );
};
