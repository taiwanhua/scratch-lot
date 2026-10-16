import { useState } from "react";
import { useTranslations } from "use-intl";

import type { FormSubmissionFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import { useSubmissionActions } from "../useSubmissionActions";
import { ReasonDialog } from "./ReasonDialog";

export interface ApplicantActionsProps {
  submission: FormSubmissionFieldsFragment;
  /** 實例的 `abilities.canWithdraw`(申請人本人、進行中、還沒有任何被接受的決定) */
  canWithdraw: boolean;
  onCopied?: (submissionId: string) => void;
}

type OpenDialog = "withdraw" | "void" | null;

/**
 * 申請人的撤回 / 作廢 / 複製為新單(Spec 6b §6):撤回要在還沒有任何審核意見前;
 * 作廢只對已核准的單(申請人自己可作廢,不需主管同意),理由必填;作廢後可「複製為新單」重送。
 */
export const ApplicantActions = ({
  submission,
  canWithdraw,
  onCopied,
}: ApplicantActionsProps) => {
  const t = useTranslations("admin.approval.applicant");
  const actions = useSubmissionActions();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [clearedFields, setClearedFields] = useState<readonly string[]>([]);
  const { canVoid, canCopy } = submission.abilities;

  if (!canWithdraw && !canVoid && !canCopy && clearedFields.length === 0) {
    return null;
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        {canWithdraw && (
          <Button
            variant="outlined"
            onClick={() => {
              actions.clearError();
              setDialog("withdraw");
            }}
          >
            {t("withdraw")}
          </Button>
        )}
        {canVoid && (
          <Button
            variant="outlined"
            color="error"
            onClick={() => {
              actions.clearError();
              setDialog("void");
            }}
          >
            {t("void")}
          </Button>
        )}
        {canCopy && (
          <Button
            variant="outlined"
            disabled={actions.isPending}
            onClick={() => {
              void actions.copy(submission).then((copied) => {
                if (copied === null) {
                  return;
                }
                setClearedFields(copied.clearedFields ?? []);
                onCopied?.(copied.id);
              });
            }}
          >
            {t("copy")}
          </Button>
        )}
      </Stack>
      {submission.voidReason !== null &&
        submission.voidReason !== undefined && (
          <Alert severity="info">
            {t("voidedReason", { reason: submission.voidReason })}
          </Alert>
        )}
      {clearedFields.length > 0 && (
        <Alert severity="warning">
          {t("clearedFields", { fields: clearedFields.join("、") })}
        </Alert>
      )}
      {dialog === "withdraw" && (
        <ReasonDialog
          namespace="admin.approval.withdraw"
          requiresReason={false}
          isSubmitting={actions.isPending}
          errorMessage={actions.errorMessage}
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            void actions.withdraw(submission).then((isDone) => {
              if (isDone) {
                setDialog(null);
              }
            });
          }}
        />
      )}
      {dialog === "void" && (
        <ReasonDialog
          namespace="admin.approval.void"
          requiresReason
          isSubmitting={actions.isPending}
          errorMessage={actions.errorMessage}
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={(reason) => {
            void actions.voidIt(submission, reason).then((isDone) => {
              if (isDone) {
                setDialog(null);
              }
            });
          }}
        />
      )}
    </Stack>
  );
};
