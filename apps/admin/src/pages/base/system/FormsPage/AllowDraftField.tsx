import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  type UpdateFormMutation,
  useUpdateFormMutation,
} from "@repo/graphql";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

export interface AllowDraftFieldProps {
  form: FormFieldsFragment;
  onChanged: () => void;
}

/**
 * 表單設定「允許存草稿」:表單層的設定(不隨版本、不必發布),以 `updateForm` 存。
 * 改得動 = `abilities.canEdit`(自己擁有的表單 + `system.forms.edit`);改不動的人看得到目前的設定但不能切。
 */
export const AllowDraftField = ({ form, onChanged }: AllowDraftFieldProps) => {
  const t = useTranslations("admin.forms.detail");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const update = useUpdateFormMutation(
    session.client,
    useMutationFeedback<UpdateFormMutation>({
      success: (payload) =>
        payload.updateForm.form.allowDraft
          ? t("allowDraftOn")
          : t("allowDraftOff"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );

  return (
    <Stack spacing={0.5}>
      <FormControlLabel
        label={t("allowDraft")}
        control={
          <Switch
            checked={form.allowDraft}
            disabled={!form.abilities.canEdit || update.isPending}
            onChange={(_event, allowDraft) => {
              update.mutate({ input: { key: form.key, allowDraft } });
            }}
          />
        }
      />
      <Typography variant="caption" color="textSecondary">
        {t("allowDraftHint")}
      </Typography>
    </Stack>
  );
};
