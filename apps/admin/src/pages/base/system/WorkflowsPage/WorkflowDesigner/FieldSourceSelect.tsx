import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import type { AssigneeSource } from "@repo/domain/workflow";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

type FieldSource = Extract<AssigneeSource, { kind: "field" }>;

/** 沒選檢查用表單時下拉是停用的,不會觸發。 */
const ignoreChange = (): void => {
  // 停用中
};

export interface FieldSourceSelectProps {
  value: FieldSource;
  onChange: (value: FieldSource) => void;
  checkFormKey: string | null;
  /** 檢查用表單裡可選的欄(使用者型引用欄、非受保護) */
  choices: readonly FieldDef[];
  /** 檢查用表單的欄位已載入(載入中不提示「沒有可選的欄位」) */
  isLoaded: boolean;
  formNameOf: (formKey: string) => string;
  isDisabled: boolean;
  /** 欄位下方說明(依用途:審核者 / 知會對象 / 通知對象 = 送出時這個欄位選的人) */
  hint: string;
}

/**
 * 人員來源「表單欄位」的欄位下拉(審核者、知會對象共用):欄位來自「檢查用表單」的目前版本;選了欄位,來源的表單就是檢查用表單。
 * 沒選檢查用表單 → 下拉只顯示「請先選檢查用表單」(不是空清單);這一關原本指向別張表單時註明,
 * 改選欄位就換成檢查用表單的欄位。檢查用表單沒有可選的欄時,下拉下方說明要先去表單設計器加一個。
 */
export const FieldSourceSelect = ({
  value,
  onChange,
  checkFormKey,
  choices,
  isLoaded,
  formNameOf,
  isDisabled,
  hint,
}: FieldSourceSelectProps) => {
  const t = useTranslations("admin.workflows.assignee");
  const isOnOtherForm =
    value.formKey !== "" &&
    checkFormKey !== null &&
    value.formKey !== checkFormKey;
  const hasCurrent = value.fieldKey !== "";
  // 目前的值不在選項裡(別張表單、受保護、或已刪掉的欄位)時照樣列出,不讓下拉變空值
  const current =
    hasCurrent && !choices.some((field) => field.key === value.fieldKey)
      ? [
          {
            value: value.fieldKey,
            label: t("fieldCurrent", {
              form: formNameOf(value.formKey),
              field: value.fieldKey,
            }),
          },
        ]
      : [];

  if (checkFormKey === null) {
    return (
      <Stack spacing={0.5}>
        <SelectField
          label={t("field")}
          value=""
          displayEmpty
          size="small"
          disabled
          helperText={hint}
          options={[
            {
              value: "",
              // 唯讀檢視改不了檢查用表單,不叫人「先選」
              label: isDisabled
                ? t("noCheckFormReadonly")
                : t("needsCheckForm"),
            },
          ]}
          onChange={ignoreChange}
        />
        {hasCurrent && (
          <Typography variant="caption" color="text.secondary">
            {t("fieldCurrent", {
              form: formNameOf(value.formKey),
              field: value.fieldKey,
            })}
          </Typography>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={0.5}>
      <SelectField
        label={t("field")}
        value={value.fieldKey}
        displayEmpty
        size="small"
        disabled={isDisabled}
        helperText={hint}
        options={[
          { value: "", label: t("fieldUnset") },
          ...choices.map((field) => ({ value: field.key, label: field.label })),
          ...current,
        ]}
        onChange={(fieldKey) => {
          onChange({ kind: "field", formKey: checkFormKey, fieldKey });
        }}
      />
      {isLoaded && choices.length === 0 && !isDisabled && (
        <Typography variant="caption" color="warning.main">
          {t("fieldNoChoices")}
        </Typography>
      )}
      {isOnOtherForm && (
        <Typography variant="caption" color="warning.main">
          {t("fieldOtherForm", { form: formNameOf(value.formKey) })}
        </Typography>
      )}
    </Stack>
  );
};
