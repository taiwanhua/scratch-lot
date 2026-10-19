import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { useRoleMatrix } from "../useRoleMatrix";
import { MatrixTree } from "./MatrixTree";

export interface PermissionMatrixTabProps {
  roleName: string;
  canEdit: boolean;
  /** 種子角色:矩陣唯讀且內容隨版本更新,多一句說明講清楚為什麼動不了 */
  isSeedRole: boolean;
  matrix: ReturnType<typeof useRoleMatrix>;
}

/**
 * 權限矩陣頁籤(Figma 57:142):標題 + 未儲存提示 + 儲存變更,底下是矩陣樹。
 * 儲存整份覆蓋(`saveRoleMatrix`),成功後由頁面精準 invalidate(DATA-04)。
 *
 * 唯讀的兩種情形各給各的說明:**沒有 `edit-matrix` 權限**時沒有儲存鍵、
 * **種子角色**時另外標一句「系統內建角色,內容隨版本更新」。
 */
export const PermissionMatrixTab = ({
  roleName,
  canEdit,
  isSeedRole,
  matrix,
}: PermissionMatrixTabProps) => {
  const t = useTranslations("admin.roleManager.matrix");
  const tErrors = useTranslations("admin.roleManager.errors");

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1">
            {t("title", { name: roleName })}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p">
            {t("subtitle")}
          </Typography>
        </Box>
        {matrix.isDirty && (
          <Typography variant="caption" color="warning.main">
            {t("unsaved")}
          </Typography>
        )}
        {canEdit && (
          <Button
            disabled={!matrix.isDirty || matrix.isSaving}
            onClick={matrix.submit}
          >
            {t("save")}
          </Button>
        )}
      </Stack>

      {isSeedRole && <Alert severity="info">{t("seedReadOnly")}</Alert>}
      {/* 天花板的一句話 root 與租戶都看得到;租戶再疊一句「只能縮不能擴」 */}
      {matrix.hasCeiling && <Alert severity="info">{t("ceiling")}</Alert>}
      {matrix.shrinkOnly && <Alert severity="info">{t("shrinkOnly")}</Alert>}
      {matrix.errorCode !== null && (
        <Alert severity="error">{tErrors(matrix.errorCode)}</Alert>
      )}
      <Typography variant="caption" color="text.secondary">
        {t("legend")}
      </Typography>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <MatrixTree
          modules={matrix.tree}
          selection={matrix.selection}
          isLoading={matrix.isLoading}
          isGroupGranted={matrix.isGroupGranted}
          onToggleGroup={matrix.toggleGroup}
          onSelectedIdsChange={matrix.changeSelection}
        />
      </Box>
    </Stack>
  );
};
