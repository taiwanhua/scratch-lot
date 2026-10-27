import { useTranslations } from "use-intl";

import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { UserActionAbility, UserRow } from "../user-manager-types";
import { UserOrgsCell } from "./UserOrgsCell";
import { UserRolesCell } from "./UserRolesCell";
import { UserRowActions } from "./UserRowActions";

export interface UserTableProps {
  rows: readonly UserRow[];
  isLoading: boolean;
  ability: UserActionAbility;
  /** 受保護的頂層組織擁有者 id(租戶視角才有值;根組織操作者一律 null) */
  protectedOwnerUserId: string | null;
  isOrgTreeAvailable: boolean;
  onEdit: (user: UserRow) => void;
  onManageOrgs: (user: UserRow) => void;
  onAssignRoles: (user: UserRow) => void;
  onToggleEnabled: (user: UserRow) => void;
  /** 以這一列為來源,開「複製組織與角色」彈窗 */
  onCopyOrgRoles: (user: UserRow) => void;
}

/**
 * 使用者清單(Figma UserTable 31:82):姓名 / 帳號 / Email / 組織 / 角色 / 狀態 / 操作。
 * 欄位以 `columns` 宣告交給 `@repo/ui` 的 `Table`,複合內容(+N、組織外、動作)各自一個子元件。
 */
export const UserTable = ({
  rows,
  isLoading,
  ability,
  protectedOwnerUserId,
  isOrgTreeAvailable,
  onEdit,
  onManageOrgs,
  onAssignRoles,
  onToggleEnabled,
  onCopyOrgRoles,
}: UserTableProps) => {
  const t = useTranslations("admin.userManager");

  const columns: TableColumn<UserRow>[] = [
    {
      key: "name",
      header: t("columns.name"),
      isEmphasized: true,
      render: (row) => row.name,
    },
    {
      key: "account",
      header: t("columns.account"),
      render: (row) => row.account,
    },
    {
      key: "email",
      header: t("columns.email"),
      render: (row) => (
        <Typography variant="body2" color="textSecondary" component="span">
          {row.email}
        </Typography>
      ),
    },
    {
      key: "orgs",
      header: t("columns.orgs"),
      render: (row) => <UserOrgsCell user={row} />,
    },
    {
      key: "roles",
      header: t("columns.roles"),
      render: (row) => <UserRolesCell user={row} />,
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (row) => (
        <Tag
          tone={row.enabled ? "success" : "error"}
          label={row.enabled ? t("status.enabled") : t("status.disabled")}
        />
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      render: (row) => (
        <UserRowActions
          user={row}
          ability={ability}
          isOwnerProtected={
            protectedOwnerUserId !== null && protectedOwnerUserId === row.id
          }
          isOrgTreeAvailable={isOrgTreeAvailable}
          onEdit={onEdit}
          onManageOrgs={onManageOrgs}
          onAssignRoles={onAssignRoles}
          onToggleEnabled={onToggleEnabled}
          onCopyOrgRoles={onCopyOrgRoles}
        />
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      isLoading={isLoading}
      emptyMessage={t("empty")}
      size="small"
      // 七個欄位(把 Figma 31:82 的 832 提到 960):組織 / 角色兩欄放得下兩三個 Tag
      // 才不會每列都折行;窄過這個寬度就橫向捲(STYLE-11)
      minWidth={960}
      aria-label={t("tableLabel")}
    />
  );
};
