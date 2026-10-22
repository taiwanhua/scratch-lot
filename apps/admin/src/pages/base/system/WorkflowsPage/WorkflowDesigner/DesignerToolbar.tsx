import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { WorkflowError } from "@/lib/base/workflow/workflow-errors";

import { CheckFormField } from "./CheckFormField";
import type { CatalogForm } from "./useDesignerCatalog";

export interface DesignerToolbarProps {
  revision: number;
  isDirty: boolean;
  isSaving: boolean;
  isEditable: boolean;
  error: WorkflowError | null;
  /** 設計器擋下不讓存的原因(例:逾時提醒的時數不合法);有值時「存草稿」停用並顯示原因 */
  saveBlockedReason: string | null;
  onSave: () => void;
  onReload: () => void;
  onAppendStep: () => void;
  forms: readonly CatalogForm[];
  checkFormKey: string | null;
  onCheckFormKeyChange: (formKey: string | null) => void;
  onCheck: () => void;
  isChecking: boolean;
  /** 平板寬才給:[整個流程設定] 打開屬性抽屜(電腦寬整個流程設定常駐在屬性面板,不需要這顆) */
  onOpenFlowSettings?: () => void;
}

/**
 * 設計器頂列:「檢查用表單」與「檢查」鈕(`CheckFormField`)、草稿修訂號、未存標示、
 * 在最後加一關、存草稿(設計器擋下時停用並說明原因);平板寬多一顆 [整個流程設定](屬性面板收在抽屜裡,沒選關卡時要有入口)。存草稿遇到 `CONFLICT`(別人先存過)→ 提示並提供「重新載入」。
 */
export const DesignerToolbar = ({
  revision,
  isDirty,
  isSaving,
  isEditable,
  error,
  saveBlockedReason,
  onSave,
  onReload,
  onAppendStep,
  forms,
  checkFormKey,
  onCheckFormKeyChange,
  onCheck,
  isChecking,
  onOpenFlowSettings,
}: DesignerToolbarProps) => {
  const t = useTranslations("admin.workflows.designer");
  const tErrors = useTranslations("admin.workflows.errors");
  const isConflict =
    error?.code === "CONFLICT" || error?.code === "DRAFT_REVISION_MISMATCH";

  return (
    <Stack spacing={1}>
      <CheckFormField
        forms={forms}
        value={checkFormKey}
        onChange={onCheckFormKeyChange}
        isDisabled={false}
        onCheck={onCheck}
        isChecking={isChecking}
      />
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {t("revision", { revision })}
        </Typography>
        {isDirty && <Tag tone="warning" label={t("dirty")} />}
        <Box sx={{ flex: 1 }} />
        {onOpenFlowSettings !== undefined && (
          <Button variant="outlined" onClick={onOpenFlowSettings}>
            {t("openFlowSettings")}
          </Button>
        )}
        {isEditable && (
          <Button variant="outlined" onClick={onAppendStep}>
            {t("appendStep")}
          </Button>
        )}
        {isEditable && (
          <Button
            disabled={!isDirty || isSaving || saveBlockedReason !== null}
            onClick={onSave}
          >
            {t("save")}
          </Button>
        )}
      </Stack>
      {isEditable && saveBlockedReason !== null && (
        <Alert severity="warning">{saveBlockedReason}</Alert>
      )}
      {error !== null && (
        <Alert
          severity="error"
          action={
            isConflict ? (
              <Button size="small" variant="text" onClick={onReload}>
                {t("reload")}
              </Button>
            ) : undefined
          }
        >
          {isConflict ? t("conflict") : tErrors(error.code)}
        </Alert>
      )}
    </Stack>
  );
};
