import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type UserDelegationFieldsFragment,
  UserDelegationStatus,
  useMyDelegationsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";
import { delegationEndShownAt } from "@/lib/base/delegation-period";

import {
  DELEGATIONS_LIST_KEY,
  DELEGATIONS_PAGE_SIZE,
  delegationsListSchema,
} from "../delegations-list";
import { DeleteDelegationDialog } from "./DeleteDelegationDialog";

const STATUS_TONE: Record<UserDelegationStatus, TagTone> = {
  [UserDelegationStatus.Upcoming]: "grey",
  [UserDelegationStatus.Active]: "success",
  [UserDelegationStatus.Ended]: "grey",
};

/**
 * 「代理人」分頁:只列自己設定的代理,依開始時間新到舊。
 * 起 / 迄顯示成最上層組織時區的「當天 00:00」/「結束日 23:59」;已結束的唯讀(沒有刪除),
 * 未開始與代理中的可以刪(已派給代理人的任務不會轉回來)。新增鈕在分頁列右側(`PersonalSettingsPage`)。
 */
export const DelegationsTab = () => {
  const t = useTranslations("admin.personalSettings.delegations");
  const { session } = useSession();
  const temporalText = useTemporalText();
  const [filters, setFilters] = useUrlState(
    DELEGATIONS_LIST_KEY,
    delegationsListSchema,
  );
  const list = useMyDelegationsQuery(session.client, {
    input: { page: filters.page, pageSize: DELEGATIONS_PAGE_SIZE },
  });
  const [deleting, setDeleting] = useState<UserDelegationFieldsFragment | null>(
    null,
  );

  const columns: TableColumn<UserDelegationFieldsFragment>[] = [
    {
      key: "delegate",
      header: t("delegate"),
      width: 200,
      isEmphasized: true,
      render: (row) => row.delegate.name ?? "—",
    },
    {
      key: "startAt",
      header: t("startAt"),
      width: 200,
      render: (row) => temporalText(row.startAt, "datetime"),
    },
    {
      key: "endAt",
      header: t("endAt"),
      width: 200,
      render: (row) =>
        temporalText(delegationEndShownAt(row.endAt), "datetime"),
    },
    {
      key: "note",
      header: t("note"),
      width: 260,
      render: (row) => row.note ?? "",
    },
    {
      key: "status",
      header: t("status"),
      width: 110,
      render: (row) => (
        <Tag
          tone={STATUS_TONE[row.status]}
          label={t(`statuses.${row.status}`)}
        />
      ),
    },
    {
      key: "actions",
      header: t("actions"),
      width: 100,
      render: (row) =>
        row.status === UserDelegationStatus.Ended ? null : (
          <Button
            size="small"
            variant="text"
            color="error"
            aria-label={t("deleteOf", { name: row.delegate.name ?? "—" })}
            onClick={() => {
              setDeleting(row);
            }}
          >
            {t("delete")}
          </Button>
        ),
    },
  ];

  const totalCount = list.data?.myDelegations.totalCount ?? 0;

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Alert severity="info">{t("hint")}</Alert>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Table
          columns={columns}
          rows={list.data?.myDelegations.items ?? []}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={list.isError ? t("loadFailed") : t("empty")}
          size="small"
          aria-label={t("tableAria")}
        />
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("total", { total: totalCount })}
        </Typography>
        <Pagination
          count={Math.max(1, Math.ceil(totalCount / DELEGATIONS_PAGE_SIZE))}
          page={filters.page}
          onChange={(_event, next) => {
            setFilters({ page: next });
          }}
        />
      </Stack>
      {deleting !== null && (
        <DeleteDelegationDialog
          delegation={deleting}
          onClose={() => {
            setDeleting(null);
          }}
        />
      )}
    </Stack>
  );
};
