import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type NotificationSettingItemFragment,
  type ResetNotificationSettingMutation,
  useResetNotificationSettingMutation,
} from "@repo/graphql";
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

import { EditNotificationSettingDialog } from "./EditNotificationSettingDialog";
import { NotificationSettingsTable } from "./NotificationSettingsTable";
import { ResetDefaultDialog } from "./ResetDefaultDialog";
import { SidebarBadgeSettingsSection } from "./SidebarBadgeSettingsSection";
import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";
import { useScheduleSummary } from "./notification-schedule";
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
 * 「admin 頁面」)。
 *
 * 版面沿用示範模組列表(說明 + 搜尋 + 表格卡片 + 頁碼):列出所有**負責人提醒**與宣告了可調時間的
 * **當事人通知**,組織範圍(唯讀)、目前的收件人與提醒時間;[編輯] 開編輯框(網址 `?edit=<類型 key>`,
 * 收件人 / 提醒時間有幾塊顯示幾塊)、[還原預設] 先確認再把可調的部分全部還原。
 * 沒有 `edit` 權限、或站在根組織 = 唯讀。
 * 下方「側欄數字」區塊(`SidebarBadgeSettingsSection`)調整誰看得到各模組的側欄數字,權限與唯讀判斷同一份。
 */
export const NotificationSettingsPage = () => {
  const t = useTranslations("admin.notificationSettings");
  const { session } = useSession();
  const data = useNotificationSettingsData();
  const typeName = useNotificationTypeName();
  const summaryOf = useAudienceSummary(
    NOTIFICATION_AUDIENCE_FIELDS,
    NOTIFICATION_AUDIENCE_ORG_SOURCES,
  );
  const scheduleOf = useScheduleSummary();

  /** 編輯彈窗記在網址 `?edit=<類型 key>`(REACT-14);沒有編輯權限、或那一種類型不存在就清掉參數。 */
  const edit = useUrlEdit();
  const editTarget = useNotificationSettingByType(
    edit.requestedId,
    data.canEdit !== false,
  );
  const editingType = useUrlEditGuard({
    edit,
    canEdit: data.canEdit,
    isMissing: editTarget.isMissing,
  });
  // 還不知道能不能改(`me` 未載入)時先不開;知道之後由 `useUrlEditGuard` 決定開或清掉參數
  const editing =
    data.canEdit === true &&
    editingType !== null &&
    editTarget.setting?.type === editingType
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
      // 失敗顯示在還原預設的確認框裡(`ResetDefaultDialog` 的 errorCode),不再跳提示
      error: () => null,
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
    // 表格下面還有側欄數字設定,不是只有一層捲動能吃掉超出量 → 不釘高,交給 <main> 捲(STYLE-08)
    <Stack spacing={2} sx={{ flexGrow: 1, flexShrink: 0 }}>
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
      <Card sx={{ flexShrink: 0 }}>
        <NotificationSettingsTable
          rows={data.rows}
          isLoading={data.isLoading}
          canEdit={data.canEdit === true}
          onEdit={(row) => {
            edit.open(row.type);
          }}
          onReset={(row) => {
            setResetError(null);
            setResetTarget(row);
          }}
        />
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

      <SidebarBadgeSettingsSection canEdit={data.canEdit} />

      {editing !== null && (
        <EditNotificationSettingDialog
          key={editing.type}
          setting={editing}
          onClose={edit.close}
          onSaved={() => {
            void data.invalidate();
            edit.close();
          }}
          onPartReset={() => {
            void data.invalidate();
          }}
        />
      )}

      {resetTarget !== null && (
        <ResetDefaultDialog
          typeName={typeName(resetTarget.type, resetTarget.name)}
          defaultAudienceSummary={
            resetTarget.category === "responsible" &&
            resetTarget.defaultAudience
              ? summaryOf(resetTarget.defaultAudience)
              : null
          }
          defaultScheduleSummary={
            resetTarget.defaultSchedule
              ? scheduleOf(
                  resetTarget.type,
                  resetTarget.defaultSchedule,
                  resetTarget.scheduleDateLabel,
                )
              : null
          }
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
