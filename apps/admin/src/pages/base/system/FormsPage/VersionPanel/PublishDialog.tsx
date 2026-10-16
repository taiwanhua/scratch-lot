import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type PublishFormVersionMutation,
  usePublishFormVersionMutation,
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
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";
import {
  useDesignerDraftStore,
  useIsDesignerDirty,
} from "@/stores/base/useDesignerDraftStore";

export interface PublishDialogProps {
  formKey: string;
  draftRevision: number;
  onClose: () => void;
  onPublished: () => void;
}

/**
 * 發布草稿(Spec 6a §6 四步發布):`changelog` 必填;帶 `expectedDraftRevision`(草稿被別人改過 → `CONFLICT`)。
 * 檢查器有錯 → `VALIDATION_FAILED` + `issues`,就地列出(改完草稿再發布);中斷則在版本面板顯示「重試」。
 */
export const PublishDialog = ({
  formKey,
  draftRevision,
  onClose,
  onPublished,
}: PublishDialogProps) => {
  const t = useTranslations("admin.forms.publish");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const [changelog, setChangelog] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  // 設計器有未存的變更:發布的是**上次存的草稿**;提示並提供先存(存完用新的修訂號發布)
  const isDirty = useIsDesignerDirty(formKey);
  const saveDraft = useDesignerDraftStore((state) => state.save);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const expectedRevision = savedRevision ?? draftRevision;

  const publish = usePublishFormVersionMutation(
    session.client,
    useMutationFeedback<PublishFormVersionMutation>({
      success: (payload) =>
        t("success", {
          version: payload.publishFormVersion.formVersion.version ?? 0,
        }),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onPublished,
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
                  formKey,
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
                <span key={`${issue.code}-${String(index)}`}>
                  {issue.message}
                </span>
              ))}
            </Stack>
          </Alert>
        )}
      </Stack>
    </Dialog>
  );
};
