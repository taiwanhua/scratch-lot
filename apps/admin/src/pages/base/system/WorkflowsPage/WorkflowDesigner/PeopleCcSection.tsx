import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import type { AssigneeSource } from "@repo/domain/workflow";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { AssigneeSourcePicker } from "./AssigneeSourcePicker";
import type { CatalogForm } from "./useDesignerCatalog";

export interface PeopleCcSectionProps {
  /** 區塊標題(關卡:「知會」;整個流程:「整個流程的知會對象」) */
  title: string;
  /** 區塊下方說明:這一處的知會對象什麼時候收到 */
  hint: string;
  value: AssigneeSource | null;
  onChange: (value: AssigneeSource | null) => void;
  /** 條件對話框標題的後半(關卡名稱 /「整個流程」) */
  stepName: string;
  isShared: boolean;
  forms: readonly CatalogForm[];
  checkFormKey: string | null;
  checkFormFields: readonly FieldDef[] | null;
  isReadonly: boolean;
}

/**
 * 知會對象的設定區塊:來源同審核者三種 + 「不知會」(預設),
 * 關卡面板與「整個流程」面板共用,只換標題與說明 —— 關卡的在那一關通過 / 被跳過時收,
 * 整個流程的在單據完成 / 駁回 / 作廢時收(說明文字讓設定者看懂這個分工)。
 */
export const PeopleCcSection = ({
  title,
  hint,
  value,
  onChange,
  stepName,
  isShared,
  forms,
  checkFormKey,
  checkFormFields,
  isReadonly,
}: PeopleCcSectionProps) => {
  const t = useTranslations("admin.workflows.step.cc");

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      <AssigneeSourcePicker
        purpose="cc"
        value={value}
        onChange={onChange}
        noneLabel={t("none")}
        stepName={stepName}
        isShared={isShared}
        forms={forms}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        isDisabled={isReadonly}
      />
      <Typography variant="caption" color="textSecondary">
        {hint}
      </Typography>
    </Stack>
  );
};
