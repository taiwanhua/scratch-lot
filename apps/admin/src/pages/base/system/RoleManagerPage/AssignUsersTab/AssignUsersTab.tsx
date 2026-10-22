import { useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import {
  ROLE_USERS_PAGE_SIZE,
  type RoleRow,
  type RoleUserRow,
} from "../role-manager-types";
import { AddUsersDialog } from "./AddUsersDialog";
import { useRoleUsers } from "./useRoleUsers";

export interface AssignUsersTabProps {
  role: RoleRow;
  canAssign: boolean;
  /** 加入 / 移除後由頁面精準 invalidate(清單的 userCount 會變) */
  onChanged: () => void;
}

/**
 * 分配使用者頁籤(Figma 66:179):清單 + 加入使用者 + 移除。
 * 「組織外」= 所屬組織皆不在角色擁有組織的子樹內(ADR-0003:授予照常有效);
 * 「擁有者保護」的那位移除會被 api 擋下,按鈕直接 disabled(ADR-0009)。
 */
export const AssignUsersTab = ({
  role,
  canAssign,
  onChanged,
}: AssignUsersTabProps) => {
  const t = useTranslations("admin.roleManager.users");
  const tErrors = useTranslations("admin.roleManager.errors");
  const [isAdding, setIsAdding] = useState(false);
  const data = useRoleUsers(role.id, () => {
    setIsAdding(false);
    onChanged();
  });

  const pageCount = Math.max(
    1,
    Math.ceil(data.totalCount / ROLE_USERS_PAGE_SIZE),
  );

  const columns: TableColumn<RoleUserRow>[] = [
    {
      key: "account",
      header: t("columns.account"),
      render: (row) => row.account,
    },
    {
      key: "name",
      header: t("columns.name"),
      isEmphasized: true,
      render: (row) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <span>{row.name}</span>
          {row.ownerProtected && <Tag label={t("ownerProtected")} />}
        </Stack>
      ),
    },
    {
      key: "orgs",
      header: t("columns.orgs"),
      render: (row) => (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <span>
            {row.orgs.length === 0
              ? t("none")
              : row.orgs.map((org) => org.name).join("、")}
          </span>
          {row.outOfScope && <Tag tone="warning" label={t("outOfScope")} />}
        </Stack>
      ),
    },
    { key: "email", header: t("columns.email"), render: (row) => row.email },
    {
      key: "actions",
      header: t("columns.actions"),
      align: "right",
      render: (row) =>
        canAssign ? (
          <Button
            variant="text"
            size="small"
            color="error"
            disabled={row.ownerProtected || data.isSubmitting}
            onClick={() => {
              data.remove(row.id);
            }}
          >
            {t("remove")}
          </Button>
        ) : null,
    },
  ];

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1">
            {t("title", { name: role.name })}
          </Typography>
          <Typography variant="caption" color="textSecondary" component="p">
            {t("outOfScopeHint")}
          </Typography>
        </Box>
        {canAssign && (
          <Button
            onClick={() => {
              data.clearError();
              setIsAdding(true);
            }}
          >
            {t("add")}
          </Button>
        )}
      </Stack>

      {data.errorCode !== null && !isAdding && (
        <Alert severity="error">{tErrors(data.errorCode)}</Alert>
      )}

      {/* 捲動責任在 Table 自己的容器:這層只把剩下的高度給它,不再自己捲 */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Table
          columns={columns}
          rows={data.rows}
          getRowKey={(row) => row.id}
          isLoading={data.isLoading}
          emptyMessage={t("empty")}
          // 四個欄位,組織欄要放得下「組織外」Tag + 多個組織名(STYLE-11)
          minWidth={720}
          aria-label={t("tableLabel")}
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("total", {
            total: data.totalCount,
            pageSize: ROLE_USERS_PAGE_SIZE,
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

      {isAdding && (
        <AddUsersDialog
          role={role}
          isSubmitting={data.isSubmitting}
          errorCode={data.errorCode}
          onCancel={() => {
            data.clearError();
            setIsAdding(false);
          }}
          onConfirm={data.add}
        />
      )}
    </Stack>
  );
};
