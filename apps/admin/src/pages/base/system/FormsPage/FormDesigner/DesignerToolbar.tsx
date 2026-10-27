import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

import type { FormError } from "@/lib/base/form-engine/form-errors";

export type DesignerMode = "design" | "preview";

export interface DesignerToolbarProps {
  mode: DesignerMode;
  onModeChange: (mode: DesignerMode) => void;
  revision: number;
  isDirty: boolean;
  isSaving: boolean;
  error: FormError | null;
  onSave: () => void;
  onReload: () => void;
  /** 平板寬才給:[表單設定] 打開屬性抽屜看表單層設定(電腦寬表單設定常駐在屬性面板,不需要這顆) */
  onOpenSettings?: () => void;
}

/**
 * 設計器頂列:設計 / 預覽切換、草稿修訂號(有未存變更時標示)、「存草稿」,以及存檔失敗的說明
 * (`CONFLICT` = 草稿已被別人更新 → 重新載入;`VALIDATION_FAILED` 列出正則問題)。
 * 平板寬多一顆 [表單設定](屬性面板收在抽屜裡,沒選欄位時要有入口)。
 */
export const DesignerToolbar = ({
  mode,
  onModeChange,
  revision,
  isDirty,
  isSaving,
  error,
  onSave,
  onReload,
  onOpenSettings,
}: DesignerToolbarProps) => {
  const t = useTranslations("admin.forms.designer");
  const tErrors = useTranslations("admin.forms.errors");

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Tabs
          aria-label={t("mode")}
          value={mode}
          onChange={(next) => {
            onModeChange(next === "preview" ? "preview" : "design");
          }}
          items={[
            { value: "design", label: t("modeDesign") },
            { value: "preview", label: t("modePreview") },
          ]}
        />
        <Box sx={{ flex: 1 }} />
        {onOpenSettings !== undefined && (
          <Button variant="outlined" onClick={onOpenSettings}>
            {t("openSettings")}
          </Button>
        )}
        <Typography variant="body2" color="textSecondary">
          {isDirty ? t("unsaved", { revision }) : t("revision", { revision })}
        </Typography>
        <Button disabled={!isDirty || isSaving} onClick={onSave}>
          {t("save")}
        </Button>
      </Stack>
      {error !== null &&
        (error.code === "CONFLICT" ? (
          <Alert
            severity="warning"
            action={
              <Button variant="text" size="small" onClick={onReload}>
                {t("reload")}
              </Button>
            }
          >
            {t("conflict")}
          </Alert>
        ) : (
          <Alert severity="error">
            <Stack spacing={0.5}>
              <span>{tErrors(error.code)}</span>
              {(error.issues ?? []).map((issue, index) => (
                <span key={`${issue.code}-${String(index)}`}>
                  {issue.message}
                </span>
              ))}
            </Stack>
          </Alert>
        ))}
    </Stack>
  );
};
