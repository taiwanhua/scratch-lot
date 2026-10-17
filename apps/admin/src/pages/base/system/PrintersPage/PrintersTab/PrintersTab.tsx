import { useState } from "react";
import { useTranslations } from "use-intl";

import { type PrinterFieldsFragment, usePrintersQuery } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";
import { useUrlState } from "@/hooks/base/useUrlState";

import { PrinterFormDialog } from "../PrinterFormDialog/PrinterFormDialog";
import { PrintersPager } from "../PrintersPager";
import { TestPrintDialog } from "../TestPrintDialog/TestPrintDialog";
import {
  PRINTERS_LIST_KEY,
  PRINTERS_PAGE_SIZE,
  type PrinterEnabledFilter,
  printersListSchema,
} from "../printers-list";
import { PRINTERS_PERMISSIONS } from "../printers-permissions";
import type { PrintersLookups } from "../usePrintersLookups";
import { PrinterStatusTag } from "./PrinterStatusTag";

const ALL = "";

const ENABLED_FILTER: Record<PrinterEnabledFilter, boolean | undefined> = {
  all: undefined,
  enabled: true,
  disabled: false,
};

export interface PrintersTabProps {
  lookups: PrintersLookups;
}

/**
 * 印表機分頁(Figma BS-10a 289:90901):篩選所屬組織 / 狀態;名稱、所屬組織、IP:Port、代理程式、
 * 預設、狀態;列上 [測試列印]、[編輯](`edit`)。編輯彈窗記在網址(`?edit=<印表機 id>`,REACT-14),
 * 從目前這一頁的清單取那一台(api 沒有單筆查詢;清單篩選與頁碼也在網址上,重新整理會回到同一頁)。
 */
export const PrintersTab = ({ lookups }: PrintersTabProps) => {
  const t = useTranslations("admin.printers.printers");
  const tStatus = useTranslations("admin.printers.enabledFilter");
  const { session } = useSession();
  const { hasPermission, isReady } = usePermissions();
  const canEdit = hasPermission(PRINTERS_PERMISSIONS.edit);
  const [filters, setFilters] = useUrlState(
    PRINTERS_LIST_KEY,
    printersListSchema,
  );
  const list = usePrintersQuery(session.client, {
    input: {
      orgId: filters.org,
      enabled: ENABLED_FILTER[filters.enabled],
      page: filters.page,
      pageSize: PRINTERS_PAGE_SIZE,
    },
  });
  const rows = list.data?.printers.items ?? [];
  const [testing, setTesting] = useState<PrinterFieldsFragment | null>(null);

  const edit = useUrlEdit();
  const requested = rows.find((row) => row.id === edit.requestedId);
  const editId = useUrlEditGuard({
    edit,
    canEdit: isReady ? canEdit : undefined,
    isMissing: list.isSuccess && requested === undefined,
  });
  const editing = editId === null ? undefined : requested;

  const columns: DataTableColumn<PrinterFieldsFragment>[] = [
    {
      key: "name",
      header: t("name"),
      width: 170,
      isEmphasized: true,
      accessor: (row) => row.name,
    },
    {
      key: "org",
      header: t("org"),
      width: 150,
      // 對照表晚到時要重畫:用 render(accessor 的值會被表格快取)
      render: ({ row }) => lookups.orgNameOf(row.orgId),
    },
    {
      key: "address",
      header: t("address"),
      width: 170,
      accessor: (row) => `${row.host}:${String(row.port)}`,
    },
    {
      key: "agent",
      header: t("agent"),
      width: 150,
      render: ({ row }) => lookups.agentOf(row.agentId)?.name ?? "—",
    },
    {
      key: "isDefault",
      header: t("isDefault"),
      width: 70,
      render: ({ row }) =>
        row.isDefault ? <Tag tone="primary" label={t("default")} /> : null,
    },
    {
      key: "status",
      header: t("status"),
      width: 100,
      render: ({ row }) => <PrinterStatusTag printer={row} />,
    },
    {
      key: "actions",
      header: t("actions"),
      width: 170,
      pinned: "right",
      render: ({ row }) =>
        canEdit ? (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              variant="text"
              disabled={!row.available}
              aria-label={t("testPrintOf", { name: row.name })}
              onClick={() => {
                setTesting(row);
              }}
            >
              {t("testPrint")}
            </Button>
            <Button
              size="small"
              variant="text"
              aria-label={t("editOf", { name: row.name })}
              onClick={() => {
                edit.open(row.id);
              }}
            >
              {t("edit")}
            </Button>
          </Stack>
        ) : null,
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <SelectField
          label={t("orgFilter")}
          value={filters.org ?? ALL}
          displayEmpty
          size="small"
          sx={{ width: 180 }}
          options={[
            { value: ALL, label: t("allOrgs") },
            ...lookups.orgs.map((org) => ({ value: org.id, label: org.path })),
          ]}
          onChange={(next) => {
            setFilters((current) => ({
              ...current,
              org: next === ALL ? null : next,
              page: 1,
            }));
          }}
        />
        <SelectField<PrinterEnabledFilter>
          label={t("statusFilter")}
          value={filters.enabled}
          size="small"
          sx={{ width: 180 }}
          options={(["all", "enabled", "disabled"] as const).map((value) => ({
            value,
            label: tStatus(value),
          }))}
          onChange={(next) => {
            setFilters((current) => ({ ...current, enabled: next, page: 1 }));
          }}
        />
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("empty")}
          size="small"
          aria-label={t("tableAria")}
        />
      </Box>
      <PrintersPager
        totalCount={list.data?.printers.totalCount ?? 0}
        page={filters.page}
        onPageChange={(next) => {
          setFilters((current) => ({ ...current, page: next }));
        }}
      />
      {editing !== undefined && (
        <PrinterFormDialog
          printer={editing}
          lookups={lookups}
          onClose={edit.close}
        />
      )}
      {testing !== null && (
        <TestPrintDialog
          printer={testing}
          agent={lookups.agentOf(testing.agentId)}
          onClose={() => {
            setTesting(null);
          }}
        />
      )}
    </Stack>
  );
};
