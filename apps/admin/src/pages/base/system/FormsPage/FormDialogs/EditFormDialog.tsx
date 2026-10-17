import { useState } from "react";
import { useTranslations } from "use-intl";

import { type FieldDef, valuePlaceholderKeyOf } from "@repo/domain/form";
import {
  type FormFieldsFragment,
  type UpdateFormMutation,
  useFormVersionQuery,
  useUpdateFormMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";
import {
  DEFAULT_TAB_LABEL_TEMPLATE,
  TAB_LABEL_PLACEHOLDERS,
  applyTabLabelTemplate,
  valuePlaceholderOf,
} from "@/lib/base/form-engine/tab-label";

export interface EditFormDialogProps {
  form: FormFieldsFragment;
  onClose: () => void;
  onSaved: () => void;
}

const UNSET = "";

/**
 * 改表單名稱與頁籤 / 標題模板(`updateForm`)。key 建立後不可改,這裡只顯示。
 * 模板能用的佔位符列在輸入框下方(摘要槽 `{{title}}` / `{{date}}` / `{{amount}}`、欄位 `{{value.<key>}}`、
 * 建立者 `{{applicant}}`、表單名 `{{form}}`、模組名 `{{module}}`、頁面種類 `{{action}}`);欄位值用下拉挑欄位插入
 * (欄位來自目前版本,沒發布過用草稿)。留空 = 用模組層的預設模板。再下方即時顯示以範例資料套用的結果
 * (留空時以預設模板 `{{title}}` 示範;沒寫 `{{action}}` 時與實際頁籤一樣自動加「檢視・」)。
 */
export const EditFormDialog = ({
  form,
  onClose,
  onSaved,
}: EditFormDialogProps) => {
  const t = useTranslations("admin.forms.edit");
  const tPages = useTranslations("admin.formEngine.pages");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const [name, setName] = useState(form.name);
  const [template, setTemplate] = useState(form.tabLabelTemplate ?? "");
  const [error, setError] = useState<FormError | null>(null);
  const hasVersion =
    form.currentVersion !== null && form.currentVersion !== undefined;
  const version = useFormVersionQuery(
    session.client,
    { formKey: form.key, version: form.currentVersion ?? null },
    { enabled: hasVersion || form.hasDraft, retry: false },
  );
  const fields = (version.data?.formVersion.formVersion.fields ??
    []) as unknown as FieldDef[];
  // 明細欄沒有單一的值可以放進模板,不列
  const insertable = fields.filter((field) => field.type !== "array");
  const samples: Record<string, string> = {
    title: t("sampleTitle"),
    date: t("sampleDate"),
    amount: t("sampleAmount"),
    applicant: t("sampleApplicant"),
    form: name.trim(),
    module: form.moduleName ?? t("sampleModule"),
  };
  const preview = applyTabLabelTemplate(
    template.trim() === "" ? DEFAULT_TAB_LABEL_TEMPLATE : template,
    (placeholder) => {
      const fieldKey = valuePlaceholderKeyOf(placeholder);
      if (fieldKey === null) {
        return samples[placeholder];
      }
      const field = fields.find((candidate) => candidate.key === fieldKey);
      return t("sampleValue", { label: field?.label ?? fieldKey });
    },
    {
      action: t("sampleAction"),
      joinAction: (action, label) =>
        tPages("tabLabelWithAction", { action, label }),
      fallback: name.trim(),
    },
  );

  const update = useUpdateFormMutation(
    session.client,
    useMutationFeedback<UpdateFormMutation>({
      success: t("success"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onSaved,
      onError: (failure) => {
        setError(formErrorOf(failure));
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={name.trim() === "" || update.isPending}
            onClick={() => {
              setError(null);
              update.mutate({
                input: {
                  key: form.key,
                  name: name.trim(),
                  tabLabelTemplate:
                    template.trim() === "" ? null : template.trim(),
                },
              });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={t("key")}
          value={form.key}
          disabled
          size="small"
          helperText={t("keyFixed")}
        />
        <TextField
          label={t("name")}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          size="small"
          required
        />
        <TextField
          label={t("template")}
          value={template}
          onChange={(event) => {
            setTemplate(event.target.value);
          }}
          helperText={t("templateHint")}
          size="small"
        />
        <SelectField<string>
          label={t("insertField")}
          value={UNSET}
          displayEmpty
          disabled={insertable.length === 0}
          helperText={
            insertable.length === 0
              ? t("insertFieldEmpty")
              : t("insertFieldHint")
          }
          options={[
            { value: UNSET, label: "—" },
            ...insertable.map((field) => ({
              value: field.key,
              label: `${field.label}(${field.key})`,
            })),
          ]}
          onChange={(fieldKey) => {
            if (fieldKey !== UNSET) {
              setTemplate(`${template}${valuePlaceholderOf(fieldKey)}`);
            }
          }}
          size="small"
        />
        <Stack spacing={0.25} role="list" aria-label={t("placeholders")}>
          <Typography variant="caption" color="text.secondary">
            {t("placeholders")}
          </Typography>
          {[...TAB_LABEL_PLACEHOLDERS, "value" as const].map((placeholder) => (
            <Typography
              key={placeholder}
              role="listitem"
              variant="caption"
              color="text.secondary"
            >
              {t("placeholderItem", {
                token:
                  placeholder === "value"
                    ? `{{${t("valueToken")}}}`
                    : `{{${placeholder}}}`,
                name: t(`placeholderNames.${placeholder}`),
              })}
            </Typography>
          ))}
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          role="status"
          aria-label={t("previewLabel")}
        >
          {preview === null
            ? t("previewEmpty")
            : t("preview", { label: preview })}
        </Typography>
        {error !== null && (
          <Alert severity="error">{tErrors(error.code)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
