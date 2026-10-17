import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import type { FormError } from "@/lib/base/form-engine/form-errors";

export interface RetiredPermissionOutcomeProps {
  permission: { name: string };
  error: FormError;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const versionsText = (versions: readonly number[] | undefined): string =>
  (versions ?? []).map((version) => `v${String(version)}`).join("、");

/**
 * 刪除退役權限被 api 擋下時的說明(`PERMISSION_NOT_DELETABLE` 的 `reasons` + `usage`):
 * - `USED_BY_DRAFTS`:還有草稿綁的版本宣告這個欄位 → 列筆數與版本,不能刪
 * - `CONFIRM_REQUIRED`:只剩已完成的單用到 → 警告刪除後只有超級管理員看得到,確認才刪
 * - `NOT_RETIRED` / `NOT_DYNAMIC`:狀態已變(重新整理清單)
 */
export const RetiredPermissionOutcome = ({
  permission,
  error,
  isPending,
  onConfirm,
  onCancel,
}: RetiredPermissionOutcomeProps) => {
  const t = useTranslations("admin.moduleManager.retired");
  const reasons = error.reasons ?? [];
  const usage = error.usage;

  if (reasons.includes("CONFIRM_REQUIRED")) {
    return (
      <Alert
        severity="warning"
        action={
          <Stack direction="row" spacing={1}>
            <Button variant="text" size="small" onClick={onCancel}>
              {t("cancel")}
            </Button>
            <Button
              size="small"
              color="error"
              disabled={isPending}
              onClick={onConfirm}
            >
              {t("confirmDelete")}
            </Button>
          </Stack>
        }
      >
        {t("confirmRequired", {
          name: permission.name,
          count: usage?.completedCount ?? 0,
          versions: versionsText(usage?.completedVersions),
        })}
      </Alert>
    );
  }
  if (reasons.includes("USED_BY_DRAFTS")) {
    return (
      <Alert severity="error">
        {t("usedByDrafts", {
          name: permission.name,
          count: usage?.draftCount ?? 0,
          versions: versionsText(usage?.draftVersions),
        })}
      </Alert>
    );
  }
  if (reasons.includes("NOT_RETIRED") || reasons.includes("NOT_DYNAMIC")) {
    return <Alert severity="error">{t("notDeletable")}</Alert>;
  }
  return <Alert severity="error">{t("failed")}</Alert>;
};
