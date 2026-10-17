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
}

/**
 * 設計器頂列:設計 / 預覽切換、草稿修訂號(有未存變更時標示)、「存草稿」,以及存檔失敗的說明
 * (`CONFLICT` = 草稿已被別人更新 → 重新載入;`VALIDATION_FAILED` 列出正則問題)。
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
        <Typography variant="body2" color="text.secondary">
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
