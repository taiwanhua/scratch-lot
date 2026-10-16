import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type NotificationSettingItemFragment,
  type ResetNotificationSettingMutation,
  useResetNotificationSettingMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useAudienceSummary } from "@/components/base/AudiencePicker/useAudienceSummary";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";
import { useNotificationTypeName } from "@/lib/base/notification-type-name";

import { EditRecipientsDialog } from "./EditRecipientsDialog";
import { NotificationSettingsTable } from "./NotificationSettingsTable";
import { ResetDefaultDialog } from "./ResetDefaultDialog";
import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";
import {
  type NotificationSettingsErrorCode,
  notificationSettingsErrorOf,
} from "./notification-settings-error";
import {
  NOTIFICATION_SETTINGS_PAGE_SIZE,
  useNotificationSettingByType,
  useNotificationSettingsData,
} from "./useNotificationSettingsData";

/**
 * 通知設定(模組 key `system.notification-settings`,正本 `docs/modules/notification-settings.md`
 * 「admin 頁面」;Figma BS-09a `289:86057` / BS-09b `289:86572`)。
 *
 * 版面沿用示範模組列表(說明 + 搜尋 + 表格卡片 + 頁碼):列出所有**負責人提醒**類型的組織範圍(唯讀)
 * 與目前的收件人;[編輯] 開「編輯收件人」(網址 `?edit=<類型 key>`)、[還原預設] 先確認再送出。
 * 沒有 `edit` 權限、或站在根組織 = 唯讀。
 */
export const NotificationSettingsPage = () => {
  const t = useTranslations("admin.notificationSettings");
  const tErrors = useTranslations("admin.notificationSettings.errors");
  const { session } = useSession();
  const data = useNotificationSettingsData();
  const typeName = useNotificationTypeName();
  const summaryOf = useAudienceSummary(
    NOTIFICATION_AUDIENCE_FIELDS,
    NOTIFICATION_AUDIENCE_ORG_SOURCES,
  );

  /** 編輯彈窗記在網址 `?edit=<類型 key>`(REACT-14);沒有編輯權限、或那一種類型不存在就清掉參數。 */
  const edit = useUrlEdit();
  const editTarget = useNotificationSettingByType(
    edit.requestedId,
    data.canEdit,
  );
  const editingType = useUrlEditGuard({
    edit,
    canEdit: data.canEdit,
    isMissing: editTarget.isMissing,
  });
  const editing =
    editingType !== null && editTarget.setting?.type === editingType
      ? editTarget.setting
      : null;

  const [resetTarget, setResetTarget] =
    useState<NotificationSettingItemFragment | null>(null);
  const [resetError, setResetError] =
    useState<NotificationSettingsErrorCode | null>(null);

  const reset = useResetNotificationSettingMutation(
    session.client,
    useMutationFeedback<ResetNotificationSettingMutation>({
      success: t("feedback.resetSuccess"),
      error: (error) => tErrors(notificationSettingsErrorOf(error).code),
      onSuccess: () => {
        setResetTarget(null);
        void data.invalidate();
      },
      onError: (error) => {
        setResetError(notificationSettingsErrorOf(error).code);
      },
    }),
  );

  const pageCount = Math.max(
    1,
    Math.ceil(data.totalCount / NOTIFICATION_SETTINGS_PAGE_SIZE),
  );

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Typography variant="body2" color="text.secondary">
        {t("intro")}
      </Typography>
      {data.isAtRoot && (
        <Typography variant="body2" color="text.secondary">
          {t("rootReadOnly")}
        </Typography>
      )}
      <TextField
        label={t("search")}
        placeholder={t("searchPlaceholder")}
        size="small"
        value={data.keyword}
        sx={{ width: 280 }}
        onChange={(event) => {
          data.setKeyword(event.target.value);
        }}
      />
      <Card
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 捲動責任在 Table 自己的容器(#299),這層只把剩下的高度給它 */}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <NotificationSettingsTable
            rows={data.rows}
            isLoading={data.isLoading}
            canEdit={data.canEdit}
            onEdit={(row) => {
              edit.open(row.type);
            }}
            onReset={(row) => {
              setResetError(null);
              setResetTarget(row);
            }}
          />
        </Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", px: 3, py: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {t("total", {
              total: data.totalCount,
              pageSize: NOTIFICATION_SETTINGS_PAGE_SIZE,
            })}
          </Typography>
          <Pagination
            count={pageCount}
            page={data.page}
            onChange={(_event, nextPage) => {
              data.setPage(nextPage);
            }}
          />
        </Stack>
      </Card>
      {data.isError && (
        <Typography variant="body2" color="error.main">
          {t("loadFailed")}
        </Typography>
      )}

      {editing !== null && (
        <EditRecipientsDialog
          key={editing.type}
          setting={editing}
          onClose={edit.close}
          onSaved={() => {
            void data.invalidate();
            edit.close();
          }}
        />
      )}

      {resetTarget !== null && (
        <ResetDefaultDialog
          typeName={typeName(resetTarget.type, resetTarget.name)}
          defaultSummary={summaryOf(resetTarget.defaultAudience)}
          isSubmitting={reset.isPending}
          errorCode={resetError}
          onCancel={() => {
            setResetError(null);
            setResetTarget(null);
          }}
          onConfirm={() => {
            setResetError(null);
            reset.mutate({ input: { type: resetTarget.type } });
          }}
        />
      )}
    </Stack>
  );
};
