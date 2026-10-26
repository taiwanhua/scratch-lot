import { useState } from "react";
import { useTranslations } from "use-intl";

import { REPRINT_REASON_OTHER } from "@repo/domain/printing";
import { useReprintReasonsQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useSession } from "@/hooks/base/useSession";

/** 對話框選好的補印原因。 */
export interface ReprintChoice {
  /** 存進 `reprintReason` 的選項值。 */
  reason: string;
  /** 選項的顯示名(印補印標示用)。 */
  reasonLabel: string;
  /** 說明;沒填是 `null`。 */
  note: string | null;
  /** 使用處給的補印選項(`ReprintVariants`)選了哪一個;沒有這個選單 = `null`。 */
  variant: string | null;
}

/**
 * 使用處給的補印選項(例:一次印好幾聯的單據要補哪一聯):對話框在原因上面多一個選單,預設第一個選項;
 * 選的值交回 `renderImage` / `documentName`(只印在單上、寫在單據名稱裡,不另存欄位)。
 */
export interface ReprintVariants {
  /** 選單的名稱(例「補印哪一聯」)。 */
  label: string;
  /** 選項;第一個是預設。 */
  options: readonly { value: string; label: string }[];
}

export interface ReprintDialogProps {
  /** 使用處給的補印選項;不給就只有原因與說明 */
  variants?: ReprintVariants | null;
  onCancel: () => void;
  onSubmit: (choice: ReprintChoice) => void;
}

/** 說明的長度上限(與 api 的文字欄位上限相同)。 */
const NOTE_MAX_LENGTH = 200;

/**
 * 補印對話框:補印原因(欄位管理「補印原因」類別的
 * 啟用選項)必填;選「其他」時說明必填。擋下時標在該欄位上、不呼叫 API。
 * 關閉即卸載(REACT-08),每次開啟都是空白。
 */
export const ReprintDialog = ({
  variants = null,
  onCancel,
  onSubmit,
}: ReprintDialogProps) => {
  const t = useTranslations("admin.printButton.reprintDialog");
  const { session } = useSession();
  const reasons = useReprintReasonsQuery(session.client);
  const options = reasons.data?.reprintReasons.items ?? [];
  const [variant, setVariant] = useState(variants?.options.at(0)?.value ?? "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const trimmedNote = note.trim();
  const reasonError = isSubmitted && reason === "";
  const noteError =
    isSubmitted && reason === REPRINT_REASON_OTHER && trimmedNote === "";

  const submit = () => {
    setIsSubmitted(true);
    const option = options.find((item) => item.value === reason);
    if (option === undefined) {
      return;
    }
    if (reason === REPRINT_REASON_OTHER && trimmedNote === "") {
      return;
    }
    onSubmit({
      reason,
      reasonLabel: option.label,
      note: trimmedNote === "" ? null : trimmedNote,
      variant: variants === null || variant === "" ? null : variant,
    });
  };

  const hasNoReasons = reasons.isSuccess && options.length === 0;
  const reasonHelper = ((): string | undefined => {
    if (reasons.isError) {
      return t("reasonsUnavailable");
    }
    return hasNoReasons ? t("noReasons") : undefined;
  })();

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button onClick={submit}>{t("submit")}</Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {variants === null ? null : (
          <SelectField
            label={variants.label}
            required
            fullWidth
            value={variant}
            options={variants.options.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
            onChange={setVariant}
          />
        )}
        <SelectField
          label={t("reason")}
          required
          fullWidth
          value={reason}
          options={options.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
          onChange={setReason}
          error={reasonError || reasons.isError || hasNoReasons}
          helperText={reasonError ? t("reasonRequired") : reasonHelper}
        />
        <TextField
          label={t("note")}
          required={reason === REPRINT_REASON_OTHER}
          fullWidth
          multiline
          minRows={2}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          error={noteError}
          helperText={noteError ? t("noteRequired") : undefined}
          slotProps={{ htmlInput: { maxLength: NOTE_MAX_LENGTH } }}
        />
      </Stack>
    </Dialog>
  );
};
