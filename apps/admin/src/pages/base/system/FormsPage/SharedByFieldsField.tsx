import { useTranslations } from "use-intl";

import { type FieldDef, isOrgReferenceField } from "@repo/domain/form";
import {
  type FormFieldsFragment,
  type UpdateFormMutation,
  useFormVersionQuery,
  useUpdateFormMutation,
} from "@repo/graphql";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

export interface SharedByFieldsFieldProps {
  form: FormFieldsFragment;
  onChanged: () => void;
}

/**
 * 表單設定「依欄位共用」:勾選的組織欄位指到的組織,也看得到這張表單的單(只能看,不能改 / 刪;ADR-0014)。
 * 表單層的設定(不隨版本、不必發布),勾了立刻以 `updateForm` 存;改得動 = `abilities.canEdit`。
 * 可勾的欄位 = 目前發布版(沒有發布版用草稿)的表單層組織引用欄;已設、但這一版沒有的欄位照樣列出(以 key 顯示),
 * 讓人取消。一個組織欄位都沒有、也沒設定 → 不顯示。
 */
export const SharedByFieldsField = ({
  form,
  onChanged,
}: SharedByFieldsFieldProps) => {
  const t = useTranslations("admin.forms.detail");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const hasCurrent =
    form.currentVersion !== null && form.currentVersion !== undefined;
  const version = useFormVersionQuery(
    session.client,
    hasCurrent
      ? { formKey: form.key, version: form.currentVersion }
      : { formKey: form.key },
    { enabled: hasCurrent || form.hasDraft, retry: false },
  );
  const update = useUpdateFormMutation(
    session.client,
    useMutationFeedback<UpdateFormMutation>({
      success: () => t("sharedByFieldsSaved"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );
  // 定義以 JSON 進出(形狀正本 `@repo/domain/form`)
  const fields = (version.data?.formVersion.formVersion.fields ??
    []) as unknown as FieldDef[];
  const selected = form.sharedByFieldKeys;
  const options = [
    ...fields
      .filter((field) => isOrgReferenceField(field))
      .map((field) => ({ key: field.key, label: field.label })),
    ...selected
      .filter((key) => !fields.some((field) => field.key === key))
      .map((key) => ({ key, label: key })),
  ];
  if (options.length === 0) {
    return null;
  }
  const toggle = (key: string, checked: boolean) => {
    const next = checked
      ? [...selected, key]
      : selected.filter((item) => item !== key);
    update.mutate({ input: { key: form.key, sharedByFieldKeys: next } });
  };

  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">{t("sharedByFields")}</Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 2 }}>
        {options.map((option) => (
          <FormControlLabel
            key={option.key}
            label={option.label}
            control={
              <Checkbox
                checked={selected.includes(option.key)}
                disabled={!form.abilities.canEdit || update.isPending}
                onChange={(_event, checked) => {
                  toggle(option.key, checked);
                }}
              />
            }
          />
        ))}
      </Stack>
      <Typography variant="caption" color="textSecondary">
        {t("sharedByFieldsHint")}
      </Typography>
    </Stack>
  );
};
