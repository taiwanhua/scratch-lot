import { useTranslations } from "use-intl";

import {
  FORM_SUBMISSION_PROVIDER,
  type FieldDef,
  type LookupSourceDescriptor,
  isLookupFilterVar,
} from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Typography } from "@repo/ui/typography";

import { formErrorOf } from "@/lib/base/form-engine/form-errors";

import { LinkedFilterEditor } from "./LinkedFilterEditor";
import { LookupLabelTemplateInput } from "./LookupLabelTemplateInput";
import {
  type LookupFieldOption,
  type LookupProviderOption,
  type SelfFormCatalog,
  useLookupFieldOptions,
  useLookupProviders,
  useProviderLabel,
  usePublishedForms,
} from "./useLookupCatalog";

export interface LookupSourceEditorProps {
  value: LookupSourceDescriptor;
  onChange: (value: LookupSourceDescriptor) => void;
  /** 值欄只在「選項來源 = lookup」出現(帶入規則、引用欄位不需要) */
  hasValueField: boolean;
  /** 目前在設計的表單:給了就能選自己當來源(帶入規則),欄位目錄用草稿的欄位 */
  selfForm?: SelfFormCatalog | null;
  /**
   * 連動篩選可引用的表單層欄位;給了才出現「連動篩選」(只有引用欄位、明細引用子欄)。
   * 呼叫端已排除自己與明細欄。
   */
  linkFields?: readonly FieldDef[];
}

const UNSET = "";

/** 目前的值不在清單裡(舊資料、目錄還在載入)時仍列出,SelectField 才顯示得出來。 */
const withCurrent = (
  options: readonly { value: string; label: string }[],
  current: string | undefined,
): { value: string; label: string }[] =>
  current === undefined ||
  current === UNSET ||
  options.some((option) => option.value === current)
    ? [...options]
    : [...options, { value: current, label: current }];

const choicesOf = (options: readonly LookupFieldOption[]) =>
  options.map(({ value, label }) => ({ value, label }));

/** 值欄可挑的欄位:專案來源只列文字欄位(依值取回以字串比對;與 api 檢查器同一條規則)。 */
const valueFieldOptionsOf = (
  options: readonly LookupFieldOption[],
  provider: LookupProviderOption | undefined,
): LookupFieldOption[] =>
  provider?.isBase === false
    ? options.filter((option) => option.type === "text")
    : [...options];

/** 有沒有固定條件可設:表單提交一定有;其他來源要宣告 `enabled` 可當篩選。 */
const hasFixedFilter = (
  value: LookupSourceDescriptor,
  provider: LookupProviderOption | undefined,
): boolean =>
  value.provider === FORM_SUBMISSION_PROVIDER ||
  provider?.filterFields.includes("enabled") === true;

/** 換來源:顯示欄 / 值欄回到該來源宣告的預設(值欄只有選項來源;預設 `id` 不寫)。 */
const switchedTo = (
  provider: string,
  declared: LookupProviderOption | undefined,
  hasValueField: boolean,
): LookupSourceDescriptor => {
  const next: LookupSourceDescriptor = {
    provider,
    labelField: declared?.labelField ?? "title",
  };
  if (hasValueField && declared !== undefined && declared.valueField !== "id") {
    next.valueField = declared.valueField;
  }
  return next;
};

/** 固定條件:使用者 / 組織 / 宣告了 `enabled` 的專案來源「只列啟用中的」(`filter.enabled`);表單提交「只列已完成的」(`completedOnly`,預設是)。 */
const isFixedFilterOn = (value: LookupSourceDescriptor): boolean =>
  value.provider === FORM_SUBMISSION_PROVIDER
    ? value.completedOnly !== false
    : value.filter?.enabled === true;

const withFixedFilter = (
  value: LookupSourceDescriptor,
  isOn: boolean,
): LookupSourceDescriptor => {
  if (value.provider === FORM_SUBMISSION_PROVIDER) {
    return { ...value, completedOnly: isOn };
  }
  const next = { ...value };
  const filter: Record<string, unknown> = { ...value.filter };
  if (isOn) {
    filter.enabled = true;
  } else {
    // 只拿掉「只列啟用中的」,連動篩選的條件留著
    Reflect.deleteProperty(filter, "enabled");
  }
  if (Object.keys(filter).length === 0) {
    Reflect.deleteProperty(next, "filter");
  } else {
    next.filter = filter;
  }
  return next;
};

/**
 * lookup 來源描述的編輯(`options.source`、`reference.source`、`prefills[].source`;`docs/concepts/form-engine.md`「lookup 來源」)。
 * 照填表時的順序排:來源 → 表單(只有表單提交)→ 顯示欄 → 顯示模板(選填)→ 固定條件(選填)→ 值欄(只有選項來源);
 * 每一格中文標籤 + 一句說明,**全部用下拉選**(表單只列本租戶看得到且有已發布版本的,欄位從該表單目前版本挑,
 * `useLookupCatalog.ts`)。來源清單以 api 的登錄表為準(`formLookupProviders`,含專案登記的來源)。
 */
export const LookupSourceEditor = ({
  value,
  onChange,
  hasValueField,
  selfForm = null,
  linkFields,
}: LookupSourceEditorProps) => {
  const t = useTranslations("admin.forms.lookupSource");
  const tForms = useTranslations("admin.forms");
  const isSubmission = value.provider === FORM_SUBMISSION_PROVIDER;
  const { forms, isTruncated } = usePublishedForms(isSubmission, selfForm);
  const fieldOptions = useLookupFieldOptions(value, selfForm);
  const tErrors = useTranslations("admin.forms.errors");
  const { providers, error: providersError } = useLookupProviders();
  const providerLabel = useProviderLabel();
  const declared = providers.find(
    (provider) => provider.key === value.provider,
  );
  const isPending = fieldOptions === null;
  const formHintKey = selfForm === null ? "formHint" : "formHintWithSelf";

  return (
    <Stack spacing={1.5}>
      <SelectField<string>
        label={t("provider")}
        value={value.provider}
        helperText={t("providerHint")}
        options={withCurrent(
          providers.map((provider) => ({
            value: provider.key,
            label: providerLabel(provider),
          })),
          value.provider,
        )}
        onChange={(provider) => {
          onChange(
            switchedTo(
              provider,
              providers.find((candidate) => candidate.key === provider),
              hasValueField,
            ),
          );
        }}
        size="small"
      />
      {providersError !== null && (
        <Alert severity="error">
          {tErrors(formErrorOf(providersError).code)}
        </Alert>
      )}
      {isSubmission && (
        <SelectField<string>
          label={t("form")}
          value={value.formKey ?? UNSET}
          displayEmpty
          helperText={t(isTruncated ? "formTruncated" : formHintKey)}
          options={[
            { value: UNSET, label: t("formUnset") },
            ...withCurrent(
              forms.map((form) => ({
                value: form.key,
                label: tForms("labelWithKey", {
                  label: form.name,
                  key: form.key,
                }),
              })),
              value.formKey,
            ),
          ]}
          onChange={(formKey) => {
            // 換表單:顯示欄回到摘要槽「標題」(每版必填,一定挑得到)
            onChange({ ...value, formKey, labelField: "title" });
          }}
          size="small"
        />
      )}
      <SelectField<string>
        label={t("labelField")}
        value={isPending ? UNSET : value.labelField}
        displayEmpty
        disabled={isPending}
        helperText={isPending ? t("labelFieldPending") : t("labelFieldHint")}
        options={
          isPending
            ? [{ value: UNSET, label: t("labelFieldPending") }]
            : withCurrent(choicesOf(fieldOptions), value.labelField)
        }
        onChange={(labelField) => {
          onChange({ ...value, labelField });
        }}
        size="small"
      />
      <LookupLabelTemplateInput
        value={value}
        fieldOptions={fieldOptions}
        onChange={onChange}
      />
      {linkFields !== undefined && declared !== undefined && (
        <LinkedFilterEditor
          value={value}
          provider={declared}
          fields={linkFields}
          onChange={onChange}
        />
      )}
      {hasFixedFilter(value, declared) &&
        !isLookupFilterVar(value.filter?.enabled) && (
          <Stack spacing={0.25}>
            <Typography variant="body2">{t("fixedFilter")}</Typography>
            <FormControlLabel
              label={isSubmission ? t("completedOnly") : t("enabledOnly")}
              control={
                <Switch
                  checked={isFixedFilterOn(value)}
                  onChange={(_event, checked) => {
                    onChange(withFixedFilter(value, checked));
                  }}
                />
              }
            />
            <Typography variant="caption" color="textSecondary">
              {t("fixedFilterHint")}
            </Typography>
          </Stack>
        )}
      {hasValueField && (
        <SelectField<string>
          label={t("valueField")}
          value={value.valueField ?? UNSET}
          displayEmpty
          helperText={t("valueFieldHint")}
          options={[
            { value: UNSET, label: t("valueFieldId") },
            ...withCurrent(
              choicesOf(valueFieldOptionsOf(fieldOptions ?? [], declared)),
              value.valueField,
            ),
          ]}
          onChange={(valueField) => {
            const next = { ...value, valueField };
            if (valueField === UNSET) {
              Reflect.deleteProperty(next, "valueField");
            }
            onChange(next);
          }}
          size="small"
        />
      )}
    </Stack>
  );
};
