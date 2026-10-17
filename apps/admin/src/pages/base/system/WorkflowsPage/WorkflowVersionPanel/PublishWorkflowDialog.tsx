import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type PublishWorkflowVersionMutation,
  usePublishWorkflowVersionMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type WorkflowError,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";
import {
  useIsWorkflowDirty,
  useWorkflowDraftStore,
} from "@/stores/base/useWorkflowDraftStore";

export interface PublishWorkflowDialogProps {
  workflowKey: string;
  draftRevision: number;
  onClose: () => void;
  onPublished: () => void;
}

/**
 * 發布草稿(同表單的四步發布,沒有欄位級權限那一步):`changelog` 必填;帶 `expectedDraftRevision`。
 * 檢查器有錯 → `VALIDATION_FAILED` + `issues`,就地列出(改完草稿再發布);中斷則在版本面板顯示「重試」。
 * 設計器有未存的變更時:發布的是**上次存的草稿**,提示並提供先存(存完以新的修訂號發布)。
 */
export const PublishWorkflowDialog = ({
  workflowKey,
  draftRevision,
  onClose,
  onPublished,
}: PublishWorkflowDialogProps) => {
  const t = useTranslations("admin.workflows.publish");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const [changelog, setChangelog] = useState("");
  const [error, setError] = useState<WorkflowError | null>(null);
  const isDirty = useIsWorkflowDirty(workflowKey);
  const saveDraft = useWorkflowDraftStore((state) => state.save);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const expectedRevision = savedRevision ?? draftRevision;

  const publish = usePublishWorkflowVersionMutation(
    session.client,
    useMutationFeedback<PublishWorkflowVersionMutation>({
      success: (payload) =>
        t("success", {
          version: payload.publishWorkflowVersion.workflowVersion.version ?? 0,
        }),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: onPublished,
      onError: (failure) => {
        setError(workflowErrorOf(failure));
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={changelog.trim() === "" || publish.isPending || isSaving}
            onClick={() => {
              setError(null);
              publish.mutate({
                input: {
                  workflowKey,
                  expectedDraftRevision: expectedRevision,
                  changelog: changelog.trim(),
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
        <Typography variant="body2">{t("body")}</Typography>
        {isDirty && saveDraft !== null && (
          <Alert
            severity="warning"
            action={
              <Button
                variant="text"
                size="small"
                disabled={isSaving}
                onClick={() => {
                  setIsSaving(true);
                  void saveDraft()
                    .then((next) => {
                      if (next !== null) {
                        setSavedRevision(next);
                      }
                    })
                    .finally(() => {
                      setIsSaving(false);
                    });
                }}
              >
                {t("saveFirst")}
              </Button>
            }
          >
            {t("unsavedWarning")}
          </Alert>
        )}
        <TextField
          label={t("changelog")}
          value={changelog}
          onChange={(event) => {
            setChangelog(event.target.value);
          }}
          multiline
          minRows={3}
          required
          size="small"
        />
        {error !== null && (
          <Alert severity="error">
            <Stack spacing={0.5}>
              <span>{tErrors(error.code)}</span>
              {(error.issues ?? []).map((issue, index) => (
                <span key={`issue-${String(index)}`}>
                  {"message" in issue ? issue.message : issue.detail}
                </span>
              ))}
            </Stack>
          </Alert>
        )}
      </Stack>
    </Dialog>
  );
};
