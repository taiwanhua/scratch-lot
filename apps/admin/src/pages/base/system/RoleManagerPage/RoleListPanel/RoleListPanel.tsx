import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { List } from "@repo/ui/list";
import { Pagination } from "@repo/ui/pagination";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type { OrgOption } from "@/lib/base/org-tree";
import { groupRoleOptions, roleMenuOptions } from "@/lib/base/role-options";

import {
  ROLES_PAGE_SIZE,
  type RoleActionAbility,
  type RoleRow,
} from "../role-manager-types";
import { RoleListRow } from "./RoleListRow";

export interface RoleListPanelProps {
  rows: readonly RoleRow[];
  isLoading: boolean;
  totalCount: number;
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  /** 擁有組織篩選;`""` = 全部(Figma 65:174 的「組織」下拉) */
  ownerOrgId: string;
  onOwnerOrgChange: (ownerOrgId: string) => void;
  /** 下拉的候選 = 操作者的管理範圍 */
  ownerOrgOptions: readonly OrgOption[];
  page: number;
  onPageChange: (page: number) => void;
  selectedRoleId: string | null;
  onSelectRole: (roleId: string) => void;
  ability: RoleActionAbility;
  onCreate: () => void;
  onEdit: (role: RoleRow) => void;
  onToggleEnabled: (role: RoleRow) => void;
  onDelete: (role: RoleRow) => void;
}

/**
 * 左側角色清單(Figma 44:625):標題 + 新增、搜尋、清單、分頁。
 * 卡片撐滿殼給的高度,只有清單區自己捲動(STYLE-08)。
 */
export const RoleListPanel = ({
  rows,
  isLoading,
  totalCount,
  keyword,
  onKeywordChange,
  ownerOrgId,
  onOwnerOrgChange,
  ownerOrgOptions,
  page,
  onPageChange,
  selectedRoleId,
  onSelectRole,
  ability,
  onCreate,
  onEdit,
  onToggleEnabled,
  onDelete,
}: RoleListPanelProps) => {
  const t = useTranslations("admin.roleManager");
  const pageCount = Math.max(1, Math.ceil(totalCount / ROLES_PAGE_SIZE));
  const rowById = new Map(rows.map((role) => [role.id, role]));
  /**
   * 根組織視角(這一頁的角色跨兩個以上租戶)才分組;租戶視角只有一組,不加標題。
   * 分組規則與另外兩個角色選單共用 `lib/base/role-options.ts`。
   */
  const groups = groupRoleOptions(roleMenuOptions(rows));

  return (
    <Card
      sx={{
        // 手機寬(主從一次只顯示一邊)清單滿版
        width: { xs: "100%", sm: 320 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        p: 1.5,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1 }}>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          {t("listTitle")}
        </Typography>
        {ability.canCreate && (
          <Button variant="text" size="small" onClick={onCreate}>
            {t("actions.create")}
          </Button>
        )}
      </Stack>
      {/* 擁有組織下拉與搜尋框並存,兩個條件疊加(api 的 RolesInput.ownerOrgId + keyword) */}
      <SelectField
        label={t("toolbar.ownerOrg")}
        displayEmpty
        size="small"
        value={ownerOrgId}
        sx={{ mt: 1.5 }}
        options={[
          { value: "", label: t("toolbar.ownerOrgAll") },
          ...ownerOrgOptions.map((option) => ({
            value: option.id,
            label: option.path,
            disabled: option.outOfScope,
          })),
        ]}
        onChange={onOwnerOrgChange}
      />
      <TextField
        label={t("toolbar.search")}
        placeholder={t("toolbar.searchPlaceholder")}
        size="small"
        value={keyword}
        sx={{ mt: 1 }}
        onChange={(event) => {
          onKeywordChange(event.target.value);
        }}
      />
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", mt: 1 }}>
        {isLoading && (
          <Stack sx={{ alignItems: "center", py: 3 }}>
            <CircularProgress size={24} aria-label={t("loading")} />
          </Stack>
        )}
        {!isLoading && rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {t("empty")}
          </Typography>
        )}
        <List disablePadding aria-label={t("listLabel")}>
          {!isLoading &&
            groups.map((group) => (
              <Box key={group.id ?? "__all__"} component="li">
                {group.name !== null && (
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    component="p"
                    sx={{ px: 1, pt: 1 }}
                  >
                    {group.name}
                  </Typography>
                )}
                {group.options.flatMap((option) => {
                  const role = rowById.get(option.id);
                  return role === undefined
                    ? []
                    : [
                        <RoleListRow
                          key={role.id}
                          role={role}
                          isSelected={role.id === selectedRoleId}
                          ability={ability}
                          onSelect={onSelectRole}
                          onEdit={onEdit}
                          onToggleEnabled={onToggleEnabled}
                          onDelete={onDelete}
                        />,
                      ];
                })}
              </Box>
            ))}
        </List>
      </Box>
      <Stack spacing={1} sx={{ alignItems: "center", pt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t("total", { total: totalCount, pageSize: ROLES_PAGE_SIZE })}
        </Typography>
        <Pagination
          count={pageCount}
          page={page}
          onChange={(_event, nextPage) => {
            onPageChange(nextPage);
          }}
        />
      </Stack>
    </Card>
  );
};
