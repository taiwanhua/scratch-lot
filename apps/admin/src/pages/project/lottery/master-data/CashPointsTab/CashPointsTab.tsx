import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  type LotteryCashPointFieldsFragment,
  useLotteryCashPointsQuery,
  useOrgTreeQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import {
  editAbilityOf,
  useUrlEdit,
  useUrlEditGuard,
} from "@/hooks/base/useUrlEdit";
import { useUrlState } from "@/hooks/base/useUrlState";
import { flattenOrgs } from "@/lib/base/org-tree";

import { CashPointDialog } from "../CashPointDialog/CashPointDialog";
import {
  CASH_POINTS_TABLE_MIN_WIDTH,
  MASTER_DATA_PAGE_SIZE,
  MASTER_DATA_PERMISSIONS,
} from "../master-data-config";
import { useMasterDataAccess } from "../useMasterDataAccess";

export interface CashPointsTabProps {
  /** 右上 [+ 新增收銀點] 按下後由頁面打開 */
  isCreating: boolean;
  onCloseCreate: () => void;
}

/** 頁碼放網址 `?cashPoints=`(REACT-14)。 */
const listSchema = z
  .object({ page: z.number().int().min(1).default(1) })
  .default({ page: 1 });

/**
 * 收銀點分頁(Figma MD-05 97:1120):分店、名稱、對應崗位、排序、印表機、狀態;
 * 每列 [編輯](`abilities.canEdit`)打開彈窗,記在網址 `?edit=<id>`。**沒有刪除**(只能停用)。
 */
export const CashPointsTab = ({
  isCreating,
  onCloseCreate,
}: CashPointsTabProps) => {
  const t = useTranslations("admin.lotteryMasterData.cashPoints");
  const { session } = useSession();
  const me = useMe();
  const access = useMasterDataAccess();
  const { hasPermission } = usePermissions();
  const [list, setList] = useUrlState("cashPoints", listSchema);
  const edit = useUrlEdit();

  const query = useLotteryCashPointsQuery(session.client, {
    input: { page: list.page, pageSize: MASTER_DATA_PAGE_SIZE },
  });
  const rows = query.data?.lotteryCashPoints.items ?? [];
  const totalCount = query.data?.lotteryCashPoints.totalCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / MASTER_DATA_PAGE_SIZE));

  // 分店選單:管理範圍(orgTree)+ 自己的所屬組織(沒有治理角色的店長只看得到自己的分店)
  const orgTree = useOrgTreeQuery(session.client);
  const orgOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const org of flattenOrgs(orgTree.data?.orgTree ?? [])) {
      options.set(org.id, org.path);
    }
    for (const org of me.data?.me.orgs ?? []) {
      if (!options.has(org.id)) {
        options.set(org.id, org.name);
      }
    }
    return [...options].map(([value, label]) => ({ value, label }));
  }, [orgTree.data, me.data]);
  const defaultOrgId = me.data?.me.currentOrg?.id ?? "";

  const requested = rows.find((row) => row.id === edit.requestedId);
  const editingId = useUrlEditGuard({
    edit,
    canEdit: editAbilityOf(
      hasPermission(MASTER_DATA_PERMISSIONS.cashPointsEdit),
      requested?.abilities.canEdit,
    ),
    isMissing:
      edit.requestedId !== null && !query.isLoading && requested === undefined,
  });
  const editing = rows.find((row) => row.id === editingId) ?? null;

  const columns: TableColumn<LotteryCashPointFieldsFragment>[] = [
    { key: "org", header: t("columns.org"), render: (row) => row.org.name },
    {
      key: "name",
      header: t("columns.name"),
      isEmphasized: true,
      render: (row) => row.name,
    },
    {
      key: "position",
      header: t("columns.position"),
      render: (row) => row.positionLabel ?? row.positionKey,
    },
    {
      key: "order",
      header: t("columns.order"),
      width: 72,
      render: (row) => row.order,
    },
    {
      key: "printer",
      header: t("columns.printer"),
      render: (row) => row.printer?.name ?? t("printerDefault"),
    },
    {
      key: "enabled",
      header: t("columns.enabled"),
      width: 88,
      render: (row) => (
        <Tag
          tone={row.enabled ? "success" : "grey"}
          label={row.enabled ? t("enabled.true") : t("enabled.false")}
        />
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      width: 96,
      render: (row) =>
        row.abilities.canEdit ? (
          <Button
            variant="text"
            size="small"
            onClick={() => {
              edit.open(row.id);
            }}
          >
            {t("edit")}
          </Button>
        ) : null,
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Table
          aria-label={t("listAria")}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={t("empty")}
          minWidth={CASH_POINTS_TABLE_MIN_WIDTH}
        />
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t("total", { total: totalCount })}
        </Typography>
        <Pagination
          count={pageCount}
          page={list.page}
          onChange={(_event, page) => {
            setList({ page });
          }}
        />
      </Stack>
      {isCreating && (
        <CashPointDialog
          cashPoint={null}
          orgOptions={orgOptions}
          defaultOrgId={defaultOrgId}
          access={access}
          onClose={onCloseCreate}
        />
      )}
      {editing !== null && (
        <CashPointDialog
          key={editing.id}
          cashPoint={editing}
          orgOptions={orgOptions}
          defaultOrgId={defaultOrgId}
          access={access}
          onClose={edit.close}
        />
      )}
    </Stack>
  );
};
