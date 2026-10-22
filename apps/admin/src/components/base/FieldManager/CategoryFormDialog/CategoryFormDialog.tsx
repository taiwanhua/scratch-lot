import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidFieldCategoryKey } from "@repo/domain/form";
import {
  type CreateFieldCategoryMutation,
  type UpdateFieldCategoryMutation,
  useCreateFieldCategoryMutation,
  useUpdateFieldCategoryMutation,
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
  FieldCategoryLike,
  FieldManagerErrorCode,
} from "../field-manager-types";

export interface CategoryFormDialogProps {
  /** 全部類別(含停用的):新增時當場擋重複的 key */
  categories: readonly FieldCategoryLike[];
  /** 給了就是編輯,沒給就是新增 */
  category?: FieldCategoryLike;
  onClose: () => void;
  onSaved: () => void;
}

type KeyProblem = "format" | "duplicate" | null;

/** 新增時 key 的當場檢查:空白不報(送出鈕另擋)、格式、與已載入的全部類別(含停用的)重複。 */
const keyProblemOf = (
  key: string,
  categories: readonly FieldCategoryLike[],
): KeyProblem => {
  if (key === "") {
    return null;
  }
  if (!isValidFieldCategoryKey(key)) {
    return "format";
  }
  return categories.some((item) => item.key === key) ? "duplicate" : null;
};

/**
 * 新增 / 編輯欄位類別(`manage-categories`;只開給 root 在畫面建的類別,系統類別唯讀)。
 *
 * 兩種模式差在 **key**:建立後不可改(表單定義以它引用類別),所以編輯時唯讀顯示、也不進
 * `updateFieldCategory` 的 input。新增時 key 的格式(`@repo/domain/form` 的
 * `isValidFieldCategoryKey`)與唯一(對照已載入的全部類別,含停用的)當場擋;
 * api 仍會回 `FIELD_CATEGORY_KEY_DUPLICATE`(兩個人同時新增),同樣標在 key 欄位。
 *
 * 彈窗關閉即卸載,初始值直接進 `useState` 的初始化器(REACT-08)。
 */
export const CategoryFormDialog = ({
  categories,
  category,
  onClose,
  onSaved,
}: CategoryFormDialogProps) => {
  const t = useTranslations("admin.fieldManager.categoryForm");
  const tErrors = useTranslations("admin.fieldManager.errors");
  const tFeedback = useTranslations("admin.fieldManager.feedback");
  const { session } = useSession();

  const isEdit = category !== undefined;
  const [key, setKey] = useState(category?.key ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [errorCode, setErrorCode] = useState<FieldManagerErrorCode | null>(
    null,
  );

  const feedback = {
    error: (error: unknown) => tErrors(fieldManagerErrorOf(error).code),
    onSuccess: onSaved,
    onError: (error: unknown) => {
      setErrorCode(fieldManagerErrorOf(error).code);
    },
  };
  const createCategory = useCreateFieldCategoryMutation(
    session.client,
    useMutationFeedback<CreateFieldCategoryMutation>({
      success: tFeedback("categoryCreateSuccess"),
      ...feedback,
    }),
  );
  const updateCategory = useUpdateFieldCategoryMutation(
    session.client,
    useMutationFeedback<UpdateFieldCategoryMutation>({
      success: tFeedback("categoryUpdateSuccess"),
      ...feedback,
    }),
  );

  const trimmedKey = key.trim();
  const keyProblem = isEdit ? null : keyProblemOf(trimmedKey, categories);
  const isDuplicate =
    keyProblem === "duplicate" || errorCode === "FIELD_CATEGORY_KEY_DUPLICATE";
  const keyError = keyProblem === "format" || isDuplicate;
  let keyHelper = t("keyHint");
  if (keyProblem === "format") {
    keyHelper = t("keyInvalid");
  } else if (isDuplicate) {
    keyHelper = tErrors("FIELD_CATEGORY_KEY_DUPLICATE");
  }

  const isPending = createCategory.isPending || updateCategory.isPending;
  const isValid =
    name.trim() !== "" &&
    (isEdit || (trimmedKey !== "" && keyProblem === null));

  const handleSubmit = () => {
    setErrorCode(null);
    const nextDescription =
      description.trim() === "" ? null : description.trim();
    if (category === undefined) {
      createCategory.mutate({
        input: {
          key: trimmedKey,
          name: name.trim(),
          description: nextDescription,
        },
      });
      return;
    }
    updateCategory.mutate({
      input: {
        id: category.id,
        name: name.trim(),
        description: nextDescription,
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
        category === undefined
          ? t("createTitle")
          : t("editTitle", { category: category.name })
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
          label={t("key")}
          value={key}
          required={!isEdit}
          fullWidth
          disabled={isEdit}
          error={keyError}
          helperText={keyHelper}
          onChange={(event) => {
            setErrorCode(null);
            setKey(event.target.value);
          }}
        />
        <TextField
          label={t("name")}
          value={name}
          required
          fullWidth
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <TextField
          label={t("description")}
          value={description}
          fullWidth
          multiline
          minRows={2}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {t("createHint")}
        </Typography>
        {errorCode !== null && errorCode !== "FIELD_CATEGORY_KEY_DUPLICATE" && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
