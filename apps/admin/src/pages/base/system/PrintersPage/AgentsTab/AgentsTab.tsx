import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type PrintAgentFieldsFragment,
  usePrintAgentsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DataTable, type DataTableColumn } from "@repo/ui/data-table";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Tag } from "@repo/ui/tag";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";

import { PrintersPager } from "../PrintersPager";
import {
  PRINTERS_LIST_KEY,
  PRINTERS_PAGE_SIZE,
  agentsListSchema,
} from "../printers-list";
import { PRINTERS_PERMISSIONS } from "../printers-permissions";
import type { PrintersLookups } from "../usePrintersLookups";
import { AgentDownloadPanel } from "./AgentDownloadPanel";
import { AgentStatusTag } from "./AgentStatusTag";
import { DisableAgentDialog } from "./DisableAgentDialog";
import { ResetPairingDialog } from "./ResetPairingDialog";

/** 列上的確認類動作(不進網址,REACT-14)。 */
interface AgentAction {
  kind: "reset" | "disable";
  agent: PrintAgentFieldsFragment;
}

export interface AgentsTabProps {
  lookups: PrintersLookups;
}

/**
 * 代理程式分頁(Figma BS-19 289:91989):上方下載區(`create` 才有)→「顯示已停用」開關 → 清單
 * (狀態、最後連線、版本 + 舊版「請更新」、[重新配對] [停用])。
 *
 * 預設只列啟用中的;開關打開才連已停用的一起列(2026-10-17 定)。已停用是終態:列上沒有任何動作。
 */
export const AgentsTab = ({ lookups }: AgentsTabProps) => {
  const t = useTranslations("admin.printers.agents");
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission(PRINTERS_PERMISSIONS.create);
  const canEdit = hasPermission(PRINTERS_PERMISSIONS.edit);
  const temporalText = useTemporalText();
  const [filters, setFilters] = useUrlState(
    PRINTERS_LIST_KEY,
    agentsListSchema,
  );
  const list = usePrintAgentsQuery(session.client, {
    input: {
      includeDisabled: filters.showDisabled,
      page: filters.page,
      pageSize: PRINTERS_PAGE_SIZE,
    },
  });
  const [action, setAction] = useState<AgentAction | null>(null);

  const renderActions = (row: PrintAgentFieldsFragment) =>
    canEdit && row.enabled ? (
      <Stack direction="row" spacing={0.5}>
        <Button
          size="small"
          variant="text"
          aria-label={t("resetPairingOf", { name: row.name })}
          onClick={() => {
            setAction({ kind: "reset", agent: row });
          }}
        >
          {t("resetPairing")}
        </Button>
        <Button
          size="small"
          variant="text"
          aria-label={t("disableOf", { name: row.name })}
          onClick={() => {
            setAction({ kind: "disable", agent: row });
          }}
        >
          {t("disable")}
        </Button>
      </Stack>
    ) : null;

  const columns: DataTableColumn<PrintAgentFieldsFragment>[] = [
    {
      key: "name",
      header: t("name"),
      width: 200,
      isEmphasized: true,
      accessor: (row) => row.name,
    },
    {
      key: "org",
      header: t("org"),
      width: 160,
      // 對照表晚到時要重畫:用 render(accessor 的值會被表格快取)
      render: ({ row }) => lookups.orgNameOf(row.orgId),
    },
    {
      key: "status",
      header: t("status"),
      width: 100,
      render: ({ row }) => <AgentStatusTag agent={row} />,
    },
    {
      key: "lastSeenAt",
      header: t("lastSeenAt"),
      width: 160,
      accessor: (row) =>
        row.lastSeenAt === null || row.lastSeenAt === undefined
          ? "—"
          : temporalText(row.lastSeenAt, "datetime"),
    },
    {
      key: "version",
      header: t("version"),
      width: 160,
      render: ({ row }) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <span>{row.version ?? "—"}</span>
          {row.updateAvailable && (
            <Tag tone="warning" label={t("updateAvailable")} />
          )}
        </Stack>
      ),
    },
    {
      key: "actions",
      header: t("actions"),
      width: 170,
      pinned: "right",
      render: ({ row }) => renderActions(row),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      {canCreate && <AgentDownloadPanel />}
      <FormControlLabel
        label={t("showDisabled")}
        control={
          <Switch
            checked={filters.showDisabled}
            onChange={(_event, checked) => {
              setFilters({ showDisabled: checked, page: 1 });
            }}
          />
        }
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={list.data?.printAgents.items ?? []}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={t("empty")}
          size="small"
          aria-label={t("tableAria")}
        />
      </Box>
      <PrintersPager
        totalCount={list.data?.printAgents.totalCount ?? 0}
        page={filters.page}
        onPageChange={(next) => {
          setFilters((current) => ({ ...current, page: next }));
        }}
      />
      {action?.kind === "reset" && (
        <ResetPairingDialog
          agent={action.agent}
          onClose={() => {
            setAction(null);
          }}
        />
      )}
      {action?.kind === "disable" && (
        <DisableAgentDialog
          agent={action.agent}
          onClose={() => {
            setAction(null);
          }}
        />
      )}
    </Stack>
  );
};
