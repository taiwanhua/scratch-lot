import { useTranslations } from "use-intl";

import { Switch } from "@repo/ui/switch";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { sortPermissions } from "../module-admin-tree";
import type { ModuleAdminPermissionLike } from "../module-manager-types";

export interface ModulePermissionTableProps {
  permissions: readonly ModuleAdminPermissionLike[];
  /** 持有 `system.module-manager.toggle-enabled` 才給開關,否則只讀狀態標籤 */
  canToggleEnabled: boolean;
  /** 這個模組屬於自鎖的那一枝:開關停用並附說明 */
  isSelfLocked: boolean;
  /** 正在送出的那一筆權限 id(同時只會有一筆) */
  pendingPermissionId: string | null;
  onTogglePermission: (
    permission: ModuleAdminPermissionLike,
    enabled: boolean,
  ) => void;
}

/**
 * 權限清單(Figma 89:263 起):名稱、key、描述,末欄是 enabled 開關。
 *
 * 停用一筆權限是**全域 kill switch** — 任何人都不再持有它、連超級管理員也不給、
 * `X.*` 也展不出它(ADR-0011 步驟 4),所以表頭上方一句話把後果講明;
 * 它不連動任何東西(權限沒有樹),因此不像停用模組那樣需要確認彈窗。
 */
export const ModulePermissionTable = ({
  permissions,
  canToggleEnabled,
  isSelfLocked,
  pendingPermissionId,
  onTogglePermission,
}: ModulePermissionTableProps) => {
  const t = useTranslations("admin.moduleManager.permissions");

  const columns: TableColumn<ModuleAdminPermissionLike>[] = [
    {
      key: "name",
      header: t("name"),
      width: 180,
      isEmphasized: true,
      render: (permission) => permission.name,
    },
    {
      key: "key",
      header: t("key"),
      render: (permission) => (
        <Typography variant="body2" color="textSecondary">
          {permission.key}
        </Typography>
      ),
    },
    {
      key: "description",
      header: t("description"),
      render: (permission) => (
        <Typography variant="body2" color="textSecondary">
          {permission.description ?? t("none")}
        </Typography>
      ),
    },
    {
      key: "enabled",
      header: t("enabled"),
      align: "right",
      width: 96,
      render: (permission) =>
        canToggleEnabled ? (
          /* 停用的開關收不到 hover,包 span 的事情交給 Tooltip 自己處理 */
          <Tooltip title={isSelfLocked ? t("selfLockedHint") : ""}>
            <Switch
              checked={permission.enabled}
              disabled={isSelfLocked || pendingPermissionId === permission.id}
              onChange={(_event, checked) => {
                onTogglePermission(permission, checked);
              }}
              slotProps={{
                input: {
                  "aria-label": t("toggleAria", { name: permission.name }),
                },
              }}
            />
          </Tooltip>
        ) : (
          <Tag
            tone={permission.enabled ? "success" : "error"}
            label={permission.enabled ? t("stateEnabled") : t("stateDisabled")}
          />
        ),
    },
  ];

  return (
    <>
      <Typography variant="subtitle2" sx={{ pt: 2, pb: 0.5 }}>
        {t("title")}
      </Typography>
      <Typography variant="caption" color="textSecondary" sx={{ pb: 1 }}>
        {t("killSwitchHint")}
      </Typography>
      <Table
        columns={columns}
        rows={sortPermissions(permissions)}
        getRowKey={(permission) => permission.id}
        size="small"
        // 名稱 180 + 動作 96 之外還有 key 與描述兩欄要看得完整(STYLE-11)
        minWidth={720}
        emptyMessage={t("empty")}
        aria-label={t("title")}
      />
    </>
  );
};
