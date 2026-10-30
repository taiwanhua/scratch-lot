import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type ResetSidebarBadgeSettingMutation,
  type SidebarBadgeSettingItemFragment,
  useResetSidebarBadgeSettingMutation,
  useSidebarBadgeSettingsQuery,
  useSidebarBadgesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { RootOrgNotice } from "@/components/base/RootOrgNotice/RootOrgNotice";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { type UrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";

import { EditSidebarBadgeDialog } from "./EditSidebarBadgeDialog";
import { useSidebarBadgeAudienceText } from "./sidebar-badge-audience";
import {
  type SidebarBadgeSettingsErrorCode,
  sidebarBadgeSettingsErrorOf,
} from "./sidebar-badge-settings-error";

/** 修改「誰看得到」的彈窗記在網址 `?badge=<模組 key>`(REACT-14 編輯彈窗;`?edit=` 已給通知類型用)。 */
export const BADGE_URL_KEY = "badge";

export interface SidebarBadgeSettingsSectionProps {
  /** 能不能改(同通知類型:有 edit 且不是站在根組織);還不知道 = undefined */
  canEdit: boolean | undefined;
}

/**
 * 通知設定頁的「側欄數字」區塊(`docs/modules/notification-settings.md`「側欄數字」):程式登記了
 * 側欄數字、這個組織有開通的模組各一列 —— 模組 / 數什麼 / 誰看得到 / [修改] [還原預設]。
 * 列不能新增(數什麼要寫程式)。[修改] 開與通知收件人同一個 `AudiencePicker`;[還原預設] 先確認。
 * 存完同時重抓側欄數字(操作者自己的側欄可能跟著變)。
 */
export const SidebarBadgeSettingsSection = ({
  canEdit,
}: SidebarBadgeSettingsSectionProps) => {
  const t = useTranslations("admin.sidebarBadgeSettings");
  const tMessages = useTranslations();
  const tErrors = useTranslations("admin.sidebarBadgeSettings.errors");
  const tShared = useTranslations("admin.notificationSettings");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const audienceText = useSidebarBadgeAudienceText();

  const query = useSidebarBadgeSettingsQuery(session.client);
  const rows: readonly SidebarBadgeSettingItemFragment[] =
    query.data?.sidebarBadgeSettings.items ?? [];

  const [requestedKey, setRequestedKey] = useUrlSelectedId(BADGE_URL_KEY);
  const edit = useMemo<UrlEdit>(
    () => ({
      requestedId: requestedKey,
      open: (id) => {
        setRequestedKey(id);
      },
      close: () => {
        setRequestedKey(null);
      },
    }),
    [requestedKey, setRequestedKey],
  );
  const editingKey = useUrlEditGuard({
    edit,
    canEdit,
    isMissing:
      requestedKey !== null &&
      (query.isError ||
        (query.isSuccess &&
          !rows.some((row) => row.moduleKey === requestedKey))),
  });
  const editing =
    canEdit === true && editingKey !== null
      ? (rows.find((row) => row.moduleKey === editingKey) ?? null)
      : null;

  const [resetTarget, setResetTarget] =
    useState<SidebarBadgeSettingItemFragment | null>(null);
  const [resetError, setResetError] =
    useState<SidebarBadgeSettingsErrorCode | null>(null);

  /** 改 / 還原後失效設定清單與側欄數字(DATA-02 / 04)。 */
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: useSidebarBadgeSettingsQuery.getKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: useSidebarBadgesQuery.getKey(),
      }),
    ]);
  };

  const reset = useResetSidebarBadgeSettingMutation(
    session.client,
    useMutationFeedback<ResetSidebarBadgeSettingMutation>({
      success: t("feedback.resetSuccess"),
      error: () => null,
      onSuccess: () => {
        setResetTarget(null);
        void invalidate();
      },
      onError: (error) => {
        setResetError(sidebarBadgeSettingsErrorOf(error).code);
      },
    }),
  );

  const descriptionOf = (row: SidebarBadgeSettingItemFragment) =>
    row.descriptionKey && tMessages.has(row.descriptionKey)
      ? tMessages(row.descriptionKey)
      : t("noDescription");

  const columns: TableColumn<SidebarBadgeSettingItemFragment>[] = [
    {
      key: "module",
      header: t("columns.module"),
      isEmphasized: true,
      render: (row) => row.moduleName,
    },
    {
      key: "description",
      header: t("columns.description"),
      render: descriptionOf,
    },
    {
      key: "audience",
      header: t("columns.audience"),
      render: (row) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" component="span">
            {audienceText(row)}
          </Typography>
          {row.isDefault && <Tag label={tShared("defaultTag")} />}
        </Stack>
      ),
    },
    ...(canEdit === true
      ? [
          {
            key: "actions",
            header: t("columns.actions"),
            render: (row: SidebarBadgeSettingItemFragment) => (
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="text"
                  size="small"
                  onClick={() => {
                    edit.open(row.moduleKey);
                  }}
                >
                  {t("actions.edit")}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  disabled={row.isDefault}
                  onClick={() => {
                    setResetError(null);
                    setResetTarget(row);
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
    <Card component="section" aria-label={t("title")} sx={{ flexShrink: 0 }}>
      <Stack spacing={0.5} sx={{ px: 3, pt: 2, pb: 1 }}>
        <Typography variant="subtitle1" component="h2">
          {t("title")}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {t("intro")}
        </Typography>
      </Stack>
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.moduleKey}
        isLoading={query.isLoading}
        emptyMessage={t("empty")}
        size="small"
        minWidth={720}
        aria-label={t("tableLabel")}
        // 區塊高度跟著內容(不釘高):預設的 height: 100% 會在 flex 欄裡解析成「區塊高度」而少掉標題那段(STYLE-11)
        containerSx={{ height: "auto" }}
      />
      {query.isError && (
        <Typography variant="body2" color="error" sx={{ px: 3, py: 1.5 }}>
          {t("loadFailed")}
        </Typography>
      )}

      {editing !== null && (
        <EditSidebarBadgeDialog
          key={editing.moduleKey}
          setting={editing}
          onClose={edit.close}
          onSaved={() => {
            void invalidate();
            edit.close();
          }}
        />
      )}

      {resetTarget !== null && (
        <Dialog
          open
          onClose={() => {
            setResetTarget(null);
          }}
          fullWidth
          maxWidth="xs"
          title={t("reset.title", { name: resetTarget.moduleName })}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setResetTarget(null);
                }}
              >
                {t("reset.cancel")}
              </Button>
              <Button
                disabled={reset.isPending}
                onClick={() => {
                  setResetError(null);
                  reset.mutate({
                    input: { moduleKey: resetTarget.moduleKey },
                  });
                }}
              >
                {t("reset.confirm")}
              </Button>
            </>
          }
        >
          <Stack spacing={2}>
            <Typography variant="body2">
              {t("reset.line", {
                audience: audienceText(resetTarget, { asDefault: true }),
              })}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {t("reset.body")}
            </Typography>
            {resetError === "TENANT_ONLY" && (
              <RootOrgNotice variant="inline" message={tErrors(resetError)} />
            )}
            {resetError !== null && resetError !== "TENANT_ONLY" && (
              <Alert severity="error">{tErrors(resetError)}</Alert>
            )}
          </Stack>
        </Dialog>
      )}
    </Card>
  );
};
