import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { DeleteIcon, EditIcon } from "@repo/ui/icons";
import { ListItemButton } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import {
  type RoleActionAbility,
  type RoleRow,
  rowAbilityOf,
} from "../role-manager-types";

export interface RoleListRowProps {
  role: RoleRow;
  isSelected: boolean;
  ability: RoleActionAbility;
  onSelect: (roleId: string) => void;
  onEdit: (role: RoleRow) => void;
  onToggleEnabled: (role: RoleRow) => void;
  onDelete: (role: RoleRow) => void;
}

/**
 * 角色清單的一列(Figma 44:630 ~ 44:648):名稱 + 狀態 / 來源標籤,第二行是擁有組織、
 * 持有人數與描述。動作只在選中的那一列出現(Figma 只在 active 列畫了圖示),
 * 並各自依「權限 × 角色種類規則」顯示(`rowAbilityOf`;種類規則由 api 算在
 * `role.abilities`,前端不重算);動作列放在可點區塊之外,避免點動作連帶選取。
 */
export const RoleListRow = ({
  role,
  isSelected,
  ability: pageAbility,
  onSelect,
  onEdit,
  onToggleEnabled,
  onDelete,
}: RoleListRowProps) => {
  const t = useTranslations("admin.roleManager");
  const ability = rowAbilityOf(pageAbility, role);
  const hasActions =
    ability.canEdit || ability.canToggleEnabled || ability.canDelete;

  return (
    <Box>
      <ListItemButton
        selected={isSelected}
        sx={{ display: "block", borderRadius: 1, px: 1, py: 1.25 }}
        onClick={() => {
          onSelect(role.id);
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2">{role.name}</Typography>
          {role.isSystem && <Tag label={t("tags.system")} />}
          {role.isTemplateCopy && (
            <Tag tone="primary" label={t("tags.templateCopy")} />
          )}
          {!role.enabled && <Tag tone="error" label={t("status.disabled")} />}
        </Stack>
        <Typography variant="caption" color="textSecondary" component="p">
          {t("rowSummary", {
            org: role.ownerOrg?.name ?? t("none"),
            count: role.userCount,
          })}
        </Typography>
        {role.description !== null && role.description !== "" && (
          <Typography variant="caption" color="textSecondary" component="p">
            {role.description}
          </Typography>
        )}
      </ListItemButton>
      {isSelected && hasActions && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ px: 0.5, pb: 0.5, alignItems: "center" }}
        >
          {ability.canEdit && (
            // 圖示鈕沒有可見文字 ⇒ 提示就是它的名字,`describeChild={false}`(REACT-10)
            <Tooltip title={t("actions.edit")} describeChild={false}>
              <IconButton
                size="small"
                aria-label={t("actions.edit")}
                onClick={() => {
                  onEdit(role);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {ability.canDelete && (
            <Tooltip title={t("actions.delete")} describeChild={false}>
              <IconButton
                size="small"
                color="error"
                aria-label={t("actions.delete")}
                onClick={() => {
                  onDelete(role);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {/* 啟用 / 停用留文字鈕:Figma `Draft/ActionIcon` 253:3264 只有 edit / delete
              兩個變體,沒有對應的圖示;而且它是兩種狀態的切換,一顆圖示表達不了 */}
          {ability.canToggleEnabled && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                onToggleEnabled(role);
              }}
            >
              {role.enabled ? t("actions.disable") : t("actions.enable")}
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
};
