import { useState } from "react";
import { useTranslations } from "use-intl";

import { WorkflowDecision } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

export interface DecisionDialogProps {
  decision: WorkflowDecision;
  stepName: string;
  isSubmitting: boolean;
  /** api 回的錯誤文案(理由缺、不允許退回…) */
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
}

/**
 * 審核決定的確認跳窗:核准的理由選填;**駁回與退回修改的理由必填**(Spec 6b §1「審核決定」)。
 */
export const DecisionDialog = ({
  decision,
  stepName,
  isSubmitting,
  errorMessage,
  onCancel,
  onConfirm,
}: DecisionDialogProps) => {
  const t = useTranslations("admin.approval.decide");
  const [comment, setComment] = useState("");
  const isRequired = decision !== WorkflowDecision.Approve;
  const isMissing = isRequired && comment.trim() === "";

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      title={t(`titles.${decision}`, { step: stepName })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            color={decision === WorkflowDecision.Approve ? "primary" : "error"}
            disabled={isMissing || isSubmitting}
            onClick={() => {
              onConfirm(comment.trim());
            }}
          >
            {t(`confirms.${decision}`)}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{t(`bodies.${decision}`)}</Typography>
        <TextField
          label={isRequired ? t("reasonRequired") : t("reasonOptional")}
          value={comment}
          onChange={(event) => {
            setComment(event.target.value);
          }}
          multiline
          minRows={3}
          required={isRequired}
          error={isMissing && comment !== ""}
          helperText={isRequired ? t("reasonHint") : ""}
          size="small"
        />
        {errorMessage !== null && (
          <Alert severity="error">{errorMessage}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
