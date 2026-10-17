import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import type { AssigneeSource } from "@repo/domain/workflow";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { PeopleCcSection } from "./PeopleCcSection";
import type { CatalogForm } from "./useDesignerCatalog";

export interface FlowSettingsPanelProps {
  /** 整個流程的知會對象(`definition.cc`);null = 不知會 */
  cc: AssigneeSource | null;
  onCcChange: (cc: AssigneeSource | null) => void;
  /** 面板頂端的操作提示(編輯:點關卡來編輯;唯讀檢視:點關卡看設定) */
  selectHint: string;
  /** 整個流程的知會對象的檢查器錯誤 / 警告 */
  issues: readonly string[];
  isShared: boolean;
  forms: readonly CatalogForm[];
  checkFormKey: string | null;
  checkFormFields: readonly FieldDef[] | null;
  isReadonly: boolean;
}

/**
 * 屬性面板沒選關卡時顯示的「整個流程」設定(《底座規格》3.9 B17):整個流程的知會對象 ——
 * 單據完成 / 被駁回 / 被作廢時收;關卡的知會對象只在那一關通過 / 被跳過時收。
 * 檢查結果裡「整個流程的知會對象」那幾筆點了也是選到這裡(取消選取關卡)。
 */
export const FlowSettingsPanel = ({
  cc,
  onCcChange,
  selectHint,
  issues,
  isShared,
  forms,
  checkFormKey,
  checkFormFields,
  isReadonly,
}: FlowSettingsPanelProps) => {
  const t = useTranslations("admin.workflows.flow");

  return (
    <Stack spacing={2} component="section" aria-label={t("region")}>
      <Typography variant="body2" color="text.secondary">
        {selectHint}
      </Typography>
      <Typography variant="subtitle1" component="h2">
        {t("title")}
      </Typography>
      <PeopleCcSection
        title={t("ccTitle")}
        hint={t("ccHint")}
        value={cc}
        onChange={onCcChange}
        stepName={t("title")}
        isShared={isShared}
        forms={forms}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        isReadonly={isReadonly}
      />
      {issues.length > 0 && (
        <Stack spacing={0.5} role="group" aria-label={t("issues")}>
          {issues.map((message) => (
            <Typography key={message} variant="caption" color="error">
              {message}
            </Typography>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
