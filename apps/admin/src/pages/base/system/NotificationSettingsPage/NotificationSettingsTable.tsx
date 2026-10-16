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
 * 負責人提醒類型清單(Figma BS-09a `289:86057`):通知類型 / 組織範圍(唯讀)/ 收件人(人員條件摘要)/ 操作。
 * 收件人沒調整過的標「預設」;[還原預設] 只在調整過的那幾列可按。
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
      render: (row) => orgScopeText(row.orgScope),
    },
    {
      key: "audience",
      header: t("columns.audience"),
      render: (row) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" component="span">
            {summaryOf(row.audience)}
          </Typography>
          {row.isDefault && <Tag label={t("defaultTag")} />}
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
                  disabled={row.isDefault}
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
      minWidth={760}
      aria-label={t("tableLabel")}
    />
  );
};
