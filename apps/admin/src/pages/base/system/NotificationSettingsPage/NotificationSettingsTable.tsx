import { useTranslations } from "use-intl";

import type { NotificationSettingItemFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useAudienceSummary } from "@/components/base/AudiencePicker/useAudienceSummary";
import { useNotificationTypeName } from "@/lib/base/notification-type-name";

import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";
import { useScheduleSummary } from "./notification-schedule";
import { useOrgScopeText } from "./useOrgScopeText";

export interface NotificationSettingsTableProps {
  rows: readonly NotificationSettingItemFragment[];
  isLoading: boolean;
  /** 沒有 `edit`(或站在根組織)= 唯讀:不顯示 [編輯] / [還原預設] */
  canEdit: boolean;
  onEdit: (row: NotificationSettingItemFragment) => void;
  onReset: (row: NotificationSettingItemFragment) => void;
}

/**
 * 通知類型清單(所有負責人提醒 + 宣告了可調時間的當事人通知):
 * 通知類型 / 組織範圍(唯讀)/ 收件人(人員條件摘要;當事人通知唯讀「由事件決定」)/ 提醒時間 / 操作。
 * 收件人、提醒時間沒調整過的各標「預設」;[還原預設] 只在有任何一塊調整過的列可按。
 */
export const NotificationSettingsTable = ({
  rows,
  isLoading,
  canEdit,
  onEdit,
  onReset,
}: NotificationSettingsTableProps) => {
  const t = useTranslations("admin.notificationSettings");
  const typeName = useNotificationTypeName();
  const orgScopeText = useOrgScopeText();
  const summaryOf = useAudienceSummary(
    NOTIFICATION_AUDIENCE_FIELDS,
    NOTIFICATION_AUDIENCE_ORG_SOURCES,
  );
  const scheduleOf = useScheduleSummary();

  const recipientsOf = (row: NotificationSettingItemFragment) => {
    if (row.category !== "responsible" || row.audience == null) {
      return (
        <Typography variant="body2" component="span" color="text.secondary">
          {row.recipientNote
            ? t("partyRecipientsWithNote", { note: row.recipientNote })
            : t("partyRecipients")}
        </Typography>
      );
    }
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" component="span">
          {summaryOf(row.audience)}
        </Typography>
        {row.isDefault && <Tag label={t("defaultTag")} />}
      </Stack>
    );
  };

  const columns: TableColumn<NotificationSettingItemFragment>[] = [
    {
      key: "type",
      header: t("columns.type"),
      isEmphasized: true,
      render: (row) => typeName(row.type, row.name),
    },
    {
      key: "orgScope",
      header: t("columns.orgScope"),
      render: (row) =>
        row.orgScope ? orgScopeText(row.orgScope) : t("orgScopeByEvent"),
    },
    {
      key: "audience",
      header: t("columns.audience"),
      render: recipientsOf,
    },
    {
      key: "schedule",
      header: t("columns.schedule"),
      render: (row) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography
            variant="body2"
            component="span"
            color={row.schedule ? undefined : "text.secondary"}
          >
            {scheduleOf(row.type, row.schedule, row.scheduleDateLabel)}
          </Typography>
          {row.schedule && row.isScheduleDefault && (
            <Tag label={t("defaultTag")} />
          )}
        </Stack>
      ),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: t("columns.actions"),
            render: (row: NotificationSettingItemFragment) => (
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    onEdit(row);
                  }}
                >
                  {t("actions.edit")}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  disabled={row.isDefault && row.isScheduleDefault}
                  onClick={() => {
                    onReset(row);
                  }}
                >
                  {t("actions.reset")}
                </Button>
              </Stack>
            ),
          },
        ]
      : []),
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.type}
      isLoading={isLoading}
      emptyMessage={t("empty")}
      size="small"
      minWidth={960}
      aria-label={t("tableLabel")}
    />
  );
};
