import { useState } from "react";
import { useTranslations } from "use-intl";

import { VOID_REASON_OTHER } from "@repo/domain/form";
import { useFormVoidReasonOptionsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import type { VoidReasonChoice } from "../useSubmissionActions";

export interface VoidDialogProps {
  /** 這張單的表單 key(作廢原因的選項由表單設定決定) */
  formKey: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (reason: VoidReasonChoice) => void;
}

/**
 * 作廢確認跳窗。表單沒設作廢原因類別 → 自由填寫理由(必填);設了 → 「作廢原因」從該類別的選項下拉挑
 * (`formVoidReasonOptions`),選「其他」時說明必填(同補印對話框)。缺東西時 [作廢] 不能按。
 * 關閉即卸載(REACT-08),每次開啟都是空白。
 */
export const VoidDialog = ({
  formKey,
  isSubmitting,
  errorMessage,
  onCancel,
  onConfirm,
}: VoidDialogProps) => {
  const t = useTranslations("admin.approval.void");
  const tCommon = useTranslations("admin.approval.dialog");
  const { session } = useSession();
  const reasons = useFormVoidReasonOptionsQuery(session.client, { formKey });
  const [reasonKey, setReasonKey] = useState("");
  const [note, setNote] = useState("");
  const payload = reasons.data?.formVoidReasonOptions;
  const hasCategory =
    payload?.categoryKey !== null && payload?.categoryKey !== undefined;
  const options = payload?.items ?? [];
  const trimmedNote = note.trim();
  const isNoteRequired = !hasCategory || reasonKey === VOID_REASON_OTHER;
  const isMissing =
    payload === undefined ||
    (hasCategory && reasonKey === "") ||
    (isNoteRequired && trimmedNote === "");
  const hasNoOptions = hasCategory && options.length === 0;

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
            {tCommon("cancel")}
          </Button>
          <Button
            color="error"
            disabled={isMissing || isSubmitting}
            onClick={() => {
              onConfirm({
                reasonKey: hasCategory ? reasonKey : null,
                reasonNote: trimmedNote,
              });
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{t("body")}</Typography>
        {reasons.isError && (
          <Alert severity="error">{t("optionsUnavailable")}</Alert>
        )}
        {hasCategory && (
          <SelectField<string>
            label={t("reasonOption")}
            required
            fullWidth
            size="small"
            value={reasonKey}
            options={options.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
            onChange={setReasonKey}
            error={hasNoOptions}
            {...(hasNoOptions && { helperText: t("noOptions") })}
          />
        )}
        {payload !== undefined && (
          <TextField
            label={hasCategory ? t("note") : t("reason")}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            multiline
            minRows={2}
            required={isNoteRequired}
            size="small"
            {...(hasCategory &&
              reasonKey === VOID_REASON_OTHER && {
                helperText: t("noteRequired"),
              })}
          />
        )}
        {errorMessage !== null && (
          <Alert severity="error">{errorMessage}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
