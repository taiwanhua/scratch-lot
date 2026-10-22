import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type CreateFieldMutation,
  type UpdateFieldMutation,
  useCreateFieldMutation,
  useUpdateFieldMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { fieldManagerErrorOf } from "../field-manager-error";
import type {
  FieldManagerErrorCode,
  FieldOptionLike,
} from "../field-manager-types";
import { toFieldForm } from "./field-form";

export interface FieldFormDialogProps {
  categoryId: string;
  categoryName: string;
  /** 給了就是編輯(自訂選項),沒給就是新增 */
  field?: FieldOptionLike;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 新增 / 編輯選項(Figma「Overlay / 新增選項」211:176)。
 *
 * 兩種模式差在**值(value)**:建立後不可改(舊資料以它對照),所以編輯時是唯讀顯示、
 * 也不進 `updateField` 的 input(field-manager.md「api 介面」)。種子選項根本不開這個彈窗
 * ——它只能切 `enabled`,表格那一列不給「編輯」。
 *
 * 彈窗關閉即卸載,初始值直接進 `useState` 的初始化器(REACT-08)。
 */
export const FieldFormDialog = ({
  categoryId,
  categoryName,
  field,
  onClose,
  onSaved,
}: FieldFormDialogProps) => {
  const t = useTranslations("admin.fieldManager.form");
  const tErrors = useTranslations("admin.fieldManager.errors");
  const tFeedback = useTranslations("admin.fieldManager.feedback");
  const { session } = useSession();

  const isEdit = field !== undefined;
  const [form, setForm] = useState(() => toFieldForm(field));
  const [errorCode, setErrorCode] = useState<FieldManagerErrorCode | null>(
    null,
  );

  const onError = (error: unknown) => {
    setErrorCode(fieldManagerErrorOf(error).code);
  };

  const feedbackError = (error: unknown) =>
    tErrors(fieldManagerErrorOf(error).code);

  const createField = useCreateFieldMutation(
    session.client,
    useMutationFeedback<CreateFieldMutation>({
      success: tFeedback("createSuccess"),
      error: feedbackError,
      onSuccess: onSaved,
      onError,
    }),
  );
  const updateField = useUpdateFieldMutation(
    session.client,
    useMutationFeedback<UpdateFieldMutation>({
      success: tFeedback("updateSuccess"),
      error: feedbackError,
      onSuccess: onSaved,
      onError,
    }),
  );

  const isPending = createField.isPending || updateField.isPending;
  const isValid =
    form.label.trim() !== "" && (isEdit || form.value.trim() !== "");
  /** 重複的 value 標在「值」欄位上(Figma 沒畫這個狀態,見 PR 的差異表)。 */
  const valueError = errorCode === "FIELD_VALUE_DUPLICATE";

  const handleSubmit = () => {
    setErrorCode(null);
    const order = Number.parseInt(form.order, 10);
    const description =
      form.description.trim() === "" ? null : form.description.trim();
    if (field === undefined) {
      createField.mutate({
        input: {
          categoryId,
          label: form.label.trim(),
          value: form.value.trim(),
          order: Number.isNaN(order) ? 0 : order,
          description,
        },
      });
      return;
    }
    updateField.mutate({
      input: {
        id: field.id,
        label: form.label.trim(),
        order: Number.isNaN(order) ? 0 : order,
        description,
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={
        isEdit
          ? t("editTitle", { category: categoryName })
          : t("createTitle", { category: categoryName })
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!isValid || isPending} onClick={handleSubmit}>
            {isEdit ? t("save") : t("submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2.25}>
        <TextField
          label={t("label")}
          value={form.label}
          required
          fullWidth
          onChange={(event) => {
            setForm({ ...form, label: event.target.value });
          }}
        />
        <TextField
          label={t("value")}
          value={form.value}
          required={!isEdit}
          fullWidth
          disabled={isEdit}
          error={valueError}
          helperText={valueError ? tErrors("FIELD_VALUE_DUPLICATE") : undefined}
          onChange={(event) => {
            setErrorCode(null);
            setForm({ ...form, value: event.target.value });
          }}
        />
        <TextField
          label={t("order")}
          value={form.order}
          fullWidth
          type="number"
          onChange={(event) => {
            setForm({ ...form, order: event.target.value });
          }}
        />
        <TextField
          label={t("description")}
          value={form.description}
          fullWidth
          multiline
          minRows={2}
          onChange={(event) => {
            setForm({ ...form, description: event.target.value });
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {isEdit ? t("editHint") : t("createHint")}
        </Typography>
        {errorCode !== null && !valueError && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
