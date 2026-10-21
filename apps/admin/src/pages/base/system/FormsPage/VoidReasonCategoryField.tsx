import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  type UpdateFormMutation,
  useFieldCategoriesQuery,
  useUpdateFormMutation,
} from "@repo/graphql";
import { SelectField } from "@repo/ui/select-field";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

export interface VoidReasonCategoryFieldProps {
  form: FormFieldsFragment;
  onChanged: () => void;
}

/** 下拉的「不設定」(存 null = 作廢原因自由填寫)。 */
const UNSET = "";

/**
 * 表單設定「作廢原因」:選一個欄位管理類別 → 作廢時原因從該類別的選項下拉挑(選「其他」要填說明);
 * 不選 = 自由填寫。表單層的設定(不隨版本、不必發布),以 `updateForm` 存;改得動 = `abilities.canEdit`。
 * 類別清單只列啟用的(同選項欄的類別下拉);已選了停用類別的,照樣以 key 顯示目前的值。
 */
export const VoidReasonCategoryField = ({
  form,
  onChanged,
}: VoidReasonCategoryFieldProps) => {
  const t = useTranslations("admin.forms.detail");
  const tForms = useTranslations("admin.forms");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const categories = useFieldCategoriesQuery(session.client, {
    input: { enabledOnly: true },
  });
  const update = useUpdateFormMutation(
    session.client,
    useMutationFeedback<UpdateFormMutation>({
      success: () => t("voidReasonCategorySaved"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );
  const current = form.voidReasonCategoryKey ?? UNSET;
  const options = (categories.data?.fieldCategories.items ?? []).map(
    (category) => ({
      value: category.key,
      label: tForms("labelWithKey", {
        label: category.name,
        key: category.key,
      }),
    }),
  );

  return (
    <SelectField<string>
      label={t("voidReasonCategory")}
      value={current}
      displayEmpty
      helperText={t("voidReasonCategoryHint")}
      disabled={!form.abilities.canEdit || update.isPending}
      options={[
        { value: UNSET, label: t("voidReasonCategoryUnset") },
        ...options,
        ...(current === UNSET ||
        options.some((option) => option.value === current)
          ? []
          : [{ value: current, label: current }]),
      ]}
      onChange={(key) => {
        update.mutate({
          input: {
            key: form.key,
            voidReasonCategoryKey: key === UNSET ? null : key,
          },
        });
      }}
      size="small"
    />
  );
};
