import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidFormKey } from "@repo/domain/form-keys";
import {
  type ForkWorkflowMutation,
  type WorkflowFieldsFragment,
  WorkflowVersionStatus,
  useForkWorkflowMutation,
  useWorkflowVersionsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type WorkflowError,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";

export interface ForkWorkflowDialogProps {
  source: WorkflowFieldsFragment;
  onClose: () => void;
  onForked: (workflowKey: string) => void;
}

/**
 * 以此為基底建流程(`forkWorkflow`):挑來源的某個**已發布或已退役**版本,
 * 填新流程的 key(建立後不可改)與名稱。租戶建出來的是客製流程(只有自己看得到,自動分派給自己);
 * 共用流程的「角色」關卡只存佔位,客製後要把它指到本租戶的角色才能發布。新流程帶一份以該版為基底的草稿。
 */
export const ForkWorkflowDialog = ({
  source,
  onClose,
  onForked,
}: ForkWorkflowDialogProps) => {
  const t = useTranslations("admin.workflows.fork");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const versions = useWorkflowVersionsQuery(session.client, {
    workflowKey: source.key,
  });
  const bases = (versions.data?.workflowVersions.items ?? []).filter(
    (item) =>
      item.version !== null &&
      item.version !== undefined &&
      (item.status === WorkflowVersionStatus.Published ||
        item.status === WorkflowVersionStatus.Retired),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const baseVersion =
    picked ??
    (source.currentVersion === null || source.currentVersion === undefined
      ? String(bases.at(0)?.version ?? "")
      : String(source.currentVersion));
  const [key, setKey] = useState(`${source.key}_`);
  const [name, setName] = useState(source.name);
  const [error, setError] = useState<WorkflowError | null>(null);
  const isKeyValid = isValidFormKey(key);

  const fork = useForkWorkflowMutation(
    session.client,
    useMutationFeedback<ForkWorkflowMutation>({
      success: t("success"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: (payload) => {
        onForked(payload.forkWorkflow.workflow.key);
      },
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
      maxWidth="xs"
      title={t("title", { name: source.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={
              !isKeyValid ||
              name.trim() === "" ||
              baseVersion === "" ||
              fork.isPending
            }
            onClick={() => {
              setError(null);
              fork.mutate({
                input: {
                  sourceKey: source.key,
                  sourceVersion: Number(baseVersion),
                  key,
                  name: name.trim(),
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
        <SelectField
          label={t("baseVersion")}
          value={baseVersion}
          options={bases.map((item) => ({
            value: String(item.version),
            label: t("versionOption", { version: item.version ?? 0 }),
          }))}
          onChange={setPicked}
          size="small"
        />
        <TextField
          label={t("key")}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
          error={!isKeyValid}
          helperText={t("keyHint")}
          size="small"
          required
        />
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
