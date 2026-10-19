import { useTranslations } from "use-intl";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import type { ModuleIconKey } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { isPermissionContainer } from "../module-admin-tree";
import { isSelfLockedModuleKey } from "../module-manager-permissions";
import type {
  ModuleAdminNodeLike,
  ModuleAdminPermissionLike,
} from "../module-manager-types";
import { ModuleDetailRow } from "./ModuleDetailRow";
import { ModuleIconField } from "./ModuleIconField";
import { ModulePermissionTable } from "./ModulePermissionTable";

export interface ModuleDetailPanelProps {
  module: ModuleAdminNodeLike | null;
  isLoading: boolean;
  canToggleEnabled: boolean;
  /** 依 `system.module-manager.set-icon`(與 `toggle-enabled` 各一把鑰匙) */
  canSetIcon: boolean;
  isModulePending: boolean;
  isIconPending: boolean;
  pendingPermissionId: string | null;
  onToggleModule: (enabled: boolean) => void;
  onChangeIcon: (icon: ModuleIconKey) => void;
  onTogglePermission: (
    permission: ModuleAdminPermissionLike,
    enabled: boolean,
  ) => void;
  /** 表單模組的列表欄位配置(`system.forms.edit`) */
  canEditListColumns: boolean;
  onEditListColumns: () => void;
}

/** `sidebarType` → 文案 key(三種類型都要看得到,樹上只標群組與隱藏頁)。 */
const SIDEBAR_TYPE_KEY: Record<ModuleSidebarType, string> = {
  [ModuleSidebarType.Group]: "sidebarGroup",
  [ModuleSidebarType.Link]: "sidebarLink",
  [ModuleSidebarType.Hidden]: "sidebarHidden",
};

/**
 * 右欄資料區(Figma ModuleDetail 89:245):名稱 + enabled 開關,底下逐列的模組資料,
 * 再底下是這個模組**這一層**宣告的權限清單。
 *
 * 除 enabled 外全部唯讀 —— 模組樹是種子資料,新增 / 改名 / 搬位置走 code + PR
 * (ADR-0002);這一頁能改的只有「開著還是關著」。
 */
export const ModuleDetailPanel = ({
  module,
  isLoading,
  canToggleEnabled,
  canSetIcon,
  isModulePending,
  isIconPending,
  pendingPermissionId,
  onToggleModule,
  onChangeIcon,
  onTogglePermission,
  canEditListColumns,
  onEditListColumns,
}: ModuleDetailPanelProps) => {
  const t = useTranslations("admin.moduleManager.detail");

  if (module === null) {
    return (
      <Card
        component="section"
        aria-label={t("region")}
        sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 3, overflow: "auto" }}
      >
        <Stack sx={{ alignItems: "center", py: 4 }}>
          {isLoading ? (
            <CircularProgress aria-label={t("loading")} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("empty")}
            </Typography>
          )}
        </Stack>
      </Card>
    );
  }

  const isSelfLocked = isSelfLockedModuleKey(module.key);
  const isContainer = isPermissionContainer(module);

  return (
    <Card
      component="section"
      aria-label={t("region")}
      sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 3, overflow: "auto" }}
    >
      <Stack spacing={0}>
        <Stack
          direction="row"
          spacing={1.25}
          sx={{ alignItems: "center", pb: 1.5 }}
        >
          <Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
            {module.name}
          </Typography>
          {canToggleEnabled ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {t("enabled")}
              </Typography>
              {/* 停用的開關收不到 hover,包 span 的事情交給 Tooltip 自己處理 */}
              <Tooltip title={isSelfLocked ? t("selfLockedHint") : ""}>
                <Switch
                  checked={module.enabled}
                  disabled={isSelfLocked || isModulePending}
                  onChange={(_event, checked) => {
                    onToggleModule(checked);
                  }}
                  slotProps={{
                    input: {
                      "aria-label": t("toggleAria", { name: module.name }),
                    },
                  }}
                />
              </Tooltip>
            </>
          ) : (
            <Tag
              tone={module.enabled ? "success" : "error"}
              label={module.enabled ? t("stateEnabled") : t("stateDisabled")}
            />
          )}
        </Stack>

        <ModuleDetailRow label={t("key")}>
          <Typography variant="body2">{module.key}</Typography>
        </ModuleDetailRow>
        <ModuleDetailRow label={t("sidebarType")}>
          {isContainer ? (
            /* 權限容器沒有畫面,只講「隱藏」不夠 —— 同一列補上它存在的理由 */
            <Stack spacing={0.25}>
              <Typography variant="body2">{t("sidebarContainer")}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t("sidebarContainerHint")}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2">
              {t(SIDEBAR_TYPE_KEY[module.sidebarType])}
            </Typography>
          )}
        </ModuleDetailRow>
        {/* 引擎只對有畫面的模組連結有意義;群組、隱藏頁、權限容器不顯示 */}
        {module.sidebarType === ModuleSidebarType.Link && (
          <ModuleDetailRow label={t("engine")}>
            <Typography variant="body2">
              {module.engine === ModuleEngine.Form
                ? t("engineForm")
                : t("engineFixed")}
            </Typography>
          </ModuleDetailRow>
        )}
        <ModuleDetailRow label={t("order")}>
          <Typography variant="body2">{module.order}</Typography>
        </ModuleDetailRow>
        <ModuleDetailRow label={t("description")}>
          <Typography variant="body2">
            {module.description ?? t("none")}
          </Typography>
        </ModuleDetailRow>
        <ModuleIconField
          icon={module.icon}
          canSetIcon={canSetIcon}
          isPending={isIconPending}
          onChange={onChangeIcon}
        />

        {module.engine === ModuleEngine.Form && (
          <ModuleDetailRow label={t("listColumns")}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {t("listColumnsHint")}
              </Typography>
              {canEditListColumns && (
                <Button variant="text" size="small" onClick={onEditListColumns}>
                  {t("editListColumns")}
                </Button>
              )}
            </Stack>
          </ModuleDetailRow>
        )}

        <ModulePermissionTable
          permissions={module.permissions}
          canToggleEnabled={canToggleEnabled}
          isSelfLocked={isSelfLocked}
          pendingPermissionId={pendingPermissionId}
          onTogglePermission={onTogglePermission}
        />
      </Stack>
    </Card>
  );
};
