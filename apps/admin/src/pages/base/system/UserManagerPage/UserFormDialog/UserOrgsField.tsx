import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { OrgOption } from "@/lib/base/org-tree";

export interface UserOrgsFieldProps {
  /** 已選的組織(含完整路徑名稱);順序 = 樹上的順序 */
  orgs: readonly OrgOption[];
  /** 可增減(新增模式);編輯模式唯讀,改所屬組織走清單上的專用彈窗 */
  isEditable: boolean;
  onRemove: (orgId: string) => void;
  onPick: () => void;
}

/**
 * 所屬組織欄(Figma 202:746):已選組織以可移除的標籤列出 +「選擇組織」開樹狀彈窗。
 * 編輯模式唯讀 —「所屬組織與角色各自有專用彈窗,不在這裡改」(user-manager.md)。
 */
export const UserOrgsField = ({
  orgs,
  isEditable,
  onRemove,
  onPick,
}: UserOrgsFieldProps) => {
  const t = useTranslations("admin.userManager.form");

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{t("orgs")}</Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        {orgs.map((org) => (
          <Tag
            key={org.id}
            label={org.path}
            onDelete={
              isEditable
                ? () => {
                    onRemove(org.id);
                  }
                : undefined
            }
            aria-label={
              isEditable ? t("removeOrg", { name: org.path }) : undefined
            }
          />
        ))}
        {isEditable && (
          <Button variant="outlined" size="small" onClick={onPick}>
            {t("pickOrgs")}
          </Button>
        )}
      </Stack>
      {!isEditable && (
        <Typography variant="caption" color="text.secondary">
          {t("orgsReadonly")}
        </Typography>
      )}
    </Stack>
  );
};
