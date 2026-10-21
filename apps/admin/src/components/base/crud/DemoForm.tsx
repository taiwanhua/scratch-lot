import { Fragment, useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";

import { DiscardChangesDialog } from "@/components/base/DiscardChangesDialog";
import { FormActions } from "@/components/base/FormActions/FormActions";
import { useUnsavedGuard } from "@/hooks/base/useUnsavedGuard";

import { DemoTextField, DemoUploadField } from "./DemoFormFields";
import { hasFieldError } from "./demo-error";
import type {
  DemoAccess,
  DemoFieldMode,
  DemoFormConfig,
  DemoFormFieldContext,
  DemoItemLike,
} from "./demo-module-config";
import { useDemoForm } from "./useDemoForm";

export interface DemoFormProps<Detail extends DemoItemLike, Values> {
  i18nNamespace: string;
  form: DemoFormConfig<Detail, Values>;
  /** 編輯的那一筆;新增為 null。**外層已經 gate 過**(資料到了才掛,REACT-08) */
  item: Detail | null;
  access: DemoAccess;
  /** 離開這一頁(取消、或儲存完成);有未儲存的變更時會先跳放棄變更確認 */
  onLeave: () => void;
}

/**
 * 新增 / 編輯共版型的表單本體(Figma 177:554)。同一份版型兩種情境,差異只有三處:
 * 標題、上方 slot(示範模組1 新增頁的填寫提示)、下方 slot(編輯頁的變更歷程)。
 *
 * 欄位、上傳欄、slot 全部由設定物件的 `config.form` 決定 ——
 * **共用元件不認得任何一個欄位名**。表單狀態的初始值只在掛載時取一次,
 * 所以這個元件由外層 gate 之後才掛(REACT-08)。
 */
export const DemoForm = <Detail extends DemoItemLike, Values>({
  i18nNamespace,
  form,
  item,
  access,
  onLeave,
}: DemoFormProps<Detail, Values>) => {
  const t = useTranslations(`${i18nNamespace}.form`);
  const tFields = useTranslations(`${i18nNamespace}.fields`);
  const tErrors = useTranslations(`${i18nNamespace}.errors`);
  const tRoot = useTranslations(i18nNamespace);

  const [isDiscarding, setIsDiscarding] = useState(false);
  const state = useDemoForm({ i18nNamespace, form, item, onSaved: onLeave });
  useUnsavedGuard(state.isDirty);

  const isEdit = item !== null;
  const { error } = state;

  /** 欄位級的錯誤標在欄位上,其餘(FORBIDDEN / NOT_FOUND / 未知)才在底部用 Alert 講。 */
  const helperText = (field: string) =>
    hasFieldError(error, field) ? tErrors(`fields.${field}`) : undefined;
  /** 欄位級的錯誤已經標在欄位上,不必再來一條橫幅。 */
  const hasBannerError =
    error !== null &&
    ((error.fields ?? []).length === 0 || error.code !== "VALIDATION_FAILED");

  /** 欄位的三態、`render` 都看得到同一組上下文(介面見 `DemoFormFieldContext`)。 */
  const modeContext = { access, isEdit, item };
  const contextOf = (
    mode: DemoFieldMode,
  ): DemoFormFieldContext<Detail, Values> => ({
    ...modeContext,
    values: state.values,
    setValue: state.setValue,
    hasError: (field) => hasFieldError(error, field),
    helperText,
    t,
    tFields,
    tRoot,
    mode,
  });

  /** 取消:改過才問一次,沒改過就直接走(問一個沒東西可放棄的問題很煩)。 */
  const handleCancel = () => {
    if (state.isDirty) {
      setIsDiscarding(true);
      return;
    }
    onLeave();
  };

  return (
    <Stack spacing={2.25}>
      <Stack spacing={0.25}>
        <Box component="h1" sx={{ typography: "subtitle1", m: 0 }}>
          {item === null
            ? t("createTitle")
            : t("editTitle", { name: item.name })}
        </Box>
      </Stack>

      {form.slots?.top?.(modeContext)}

      {form.fields.map((field) => {
        // `hidden` 是欄位級權限的「沒有權限」態:整欄不渲染,input 裡也不會有這個鍵
        const mode = field.mode?.(modeContext) ?? "editable";
        if (mode === "hidden") {
          return null;
        }
        const context = contextOf(mode);
        return (
          <Fragment key={field.key}>
            {field.kind === "custom" && field.render !== undefined ? (
              field.render(context)
            ) : (
              <DemoTextField field={field} context={context} />
            )}
          </Fragment>
        );
      })}

      {form.uploads.length > 0 && (
        <Stack direction="row" spacing={2.5} sx={{ alignItems: "flex-start" }}>
          {form.uploads.map((definition) => (
            <DemoUploadField
              key={definition.key}
              definition={definition}
              item={item}
              form={state}
              t={t}
              tFields={tFields}
            />
          ))}
        </Stack>
      )}

      {form.slots?.bottom?.(modeContext)}

      {hasBannerError && <Alert severity="error">{tErrors(error.code)}</Alert>}

      <FormActions
        // DemoFormPage 的捲動卡片是 `px: 3`
        gutter={3}
        cancel={{ label: t("cancel"), onClick: handleCancel }}
        submit={{
          label: t("save"),
          disabled: state.isSubmitting,
          onClick: state.submit,
        }}
      />

      {isDiscarding && (
        <DiscardChangesDialog
          namespace={`${i18nNamespace}.discard`}
          onCancel={() => {
            setIsDiscarding(false);
          }}
          onConfirm={onLeave}
        />
      )}
    </Stack>
  );
};
