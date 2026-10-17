import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidFormKey } from "@repo/domain/form-keys";
import {
  type CreateWorkflowMutation,
  type UpdateWorkflowMutation,
  type WorkflowFieldsFragment,
  useCreateWorkflowMutation,
  useUpdateWorkflowMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type WorkflowError,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";

export interface WorkflowNameDialogProps {
  /** 改名稱時給;建立時省略(多一個 key 欄,建立後不可改) */
  workflow?: WorkflowFieldsFragment;
  onClose: () => void;
  onSaved: (workflowKey: string) => void;
}

/**
 * 建立流程 / 改名稱(Spec 6b §7 `createWorkflow` / `updateWorkflow`)。建立時填 key(全域唯一,格式同表單 key,
 * **建立後不可改**)與名稱;站在根組織建的是共用流程,站在租戶內建的是本租戶的客製流程(api 決定)。
 */
export const WorkflowNameDialog = ({
  workflow,
  onClose,
  onSaved,
}: WorkflowNameDialogProps) => {
  const t = useTranslations("admin.workflows.nameDialog");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const isCreating = workflow === undefined;
  const [key, setKey] = useState("");
  const [name, setName] = useState(workflow?.name ?? "");
  const [error, setError] = useState<WorkflowError | null>(null);
  const isKeyValid = !isCreating || isValidFormKey(key);
  const onError = (failure: unknown) => {
    setError(workflowErrorOf(failure));
  };

  const create = useCreateWorkflowMutation(
    session.client,
    useMutationFeedback<CreateWorkflowMutation>({
      success: t("created"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: (payload) => {
        onSaved(payload.createWorkflow.workflow.key);
      },
      onError,
    }),
  );
  const update = useUpdateWorkflowMutation(
    session.client,
    useMutationFeedback<UpdateWorkflowMutation>({
      success: t("updated"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: (payload) => {
        onSaved(payload.updateWorkflow.workflow.key);
      },
      onError,
    }),
  );
  const isPending = create.isPending || update.isPending;

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={isCreating ? t("createTitle") : t("editTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={!isKeyValid || name.trim() === "" || isPending}
            onClick={() => {
              setError(null);
              if (isCreating) {
                create.mutate({ input: { key, name: name.trim() } });
              } else {
                update.mutate({
                  input: { key: workflow.key, name: name.trim() },
                });
              }
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {isCreating && (
          <TextField
            label={t("key")}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
            }}
            error={key !== "" && !isKeyValid}
            helperText={t("keyHint")}
            size="small"
            required
          />
        )}
        <TextField
          label={t("name")}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          size="small"
          required
        />
        {error !== null && (
          <Alert severity="error">{tErrors(error.code)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
