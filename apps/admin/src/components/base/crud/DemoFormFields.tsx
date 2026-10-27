import type { ReactNode } from "react";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { UploadField } from "@repo/ui/upload-field";

import type {
  DemoFormField,
  DemoFormFieldContext,
  DemoItemLike,
  DemoTranslator,
  DemoUpload,
} from "./demo-module-config";
import type { DemoFormState } from "./useDemoForm";

/**
 * 一個文字 / 多行欄位。`custom` 的欄位不會走到這裡(由設定物件的 `render` 自己畫)。
 *
 * `readonly` 態:欄位看得到、改不動,旁邊就地寫明原因 —— 這是欄位級權限的中間態,
 * 不寫原因的話使用者只會覺得畫面壞了。
 */
export const DemoTextField = <Detail, Values>({
  field,
  context,
}: {
  field: DemoFormField<Detail, Values>;
  context: DemoFormFieldContext<Detail, Values>;
}): ReactNode => {
  const { values, setValue, hasError, helperText, t, tFields, mode } = context;
  const value = (values as Record<string, unknown>)[field.key];

  const input = (
    <TextField
      label={tFields(field.key)}
      required={field.required ?? false}
      size="small"
      multiline={field.kind === "multiline"}
      minRows={field.kind === "multiline" ? (field.minRows ?? 2) : undefined}
      value={typeof value === "string" ? value : ""}
      disabled={mode === "readonly"}
      error={hasError(field.key)}
      helperText={helperText(field.key)}
      // 窄螢幕不超出卡片:寬度是上限,不夠時縮到欄寬
      sx={{ width: field.width ?? 360, maxWidth: "100%" }}
      onChange={(event) => {
        setValue(field.key as keyof Values, event.target.value as never);
      }}
    />
  );

  if (mode !== "readonly" || field.readonlyHintKey === undefined) {
    return input;
  }
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
      {input}
      <Box sx={{ typography: "caption", color: "text.secondary" }}>
        {t(field.readonlyHintKey)}
      </Box>
    </Stack>
  );
};

/**
 * 一個上傳欄(ADR-0010 的雙路儲存)。
 *
 * 有 `previewUrlOf`(公開封面)時直接交給 `UploadField` 的 `initialPreviewUrl`;
 * **私有附件沒有可預覽的網址**,硬塞路徑只會出現一張破圖,所以改成另起一行
 * 「目前的附件:<檔名>」+「移除附件」,`UploadField` 只負責選新檔。
 */
export const DemoUploadField = <Detail extends DemoItemLike, Values>({
  definition,
  item,
  form,
  t,
  tFields,
}: {
  definition: DemoUpload<Detail>;
  item: Detail | null;
  form: DemoFormState<Values>;
  t: DemoTranslator;
  tFields: DemoTranslator;
}): ReactNode => {
  const slot = form.slotOf(definition.key);
  const previewUrl =
    definition.previewUrlOf === undefined || item === null
      ? null
      : (definition.previewUrlOf(item) ?? null);
  const currentName =
    definition.currentNameOf === undefined || item === null
      ? null
      : definition.currentNameOf(item);

  const uploadField = (
    <UploadField
      label={tFields(definition.key)}
      hint={t(definition.hintKey)}
      value={slot.file}
      initialPreviewUrl={slot.isCleared ? null : previewUrl}
      initialPreviewLabel={
        definition.previewLabelKey === undefined
          ? undefined
          : t(definition.previewLabelKey)
      }
      accept={definition.accept}
      maxSize={definition.maxSize}
      sx={definition.previewUrlOf === undefined ? undefined : { width: 340 }}
      onChange={(file) => {
        form.setSlot(definition.key, {
          file,
          isCleared:
            definition.previewUrlOf === undefined
              ? file === null && slot.isCleared
              : file === null,
        });
      }}
    />
  );

  if (currentName === null) {
    return uploadField;
  }

  return (
    <Stack spacing={0.75} sx={{ width: definition.width ?? 340 }}>
      {!slot.isCleared && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box sx={{ typography: "body2", flex: 1, minWidth: 0 }}>
            {t(definition.currentLabelKey ?? "attachmentCurrent", {
              name: currentName,
            })}
          </Box>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              form.setSlot(definition.key, { file: null, isCleared: true });
            }}
          >
            {t(definition.removeLabelKey ?? "removeAttachment")}
          </Button>
        </Stack>
      )}
      {uploadField}
    </Stack>
  );
};
