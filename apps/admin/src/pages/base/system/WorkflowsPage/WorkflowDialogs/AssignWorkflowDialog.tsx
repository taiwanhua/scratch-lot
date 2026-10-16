import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type WorkflowFieldsFragment,
  useAssignWorkflowToTenantsMutation,
  useOrgTreeQuery,
  useRevokeWorkflowFromTenantMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type WorkflowError,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";

export interface AssignWorkflowDialogProps {
  workflow: WorkflowFieldsFragment;
  onClose: () => void;
  onChanged: () => void;
}

interface TenantOption {
  id: string;
  name: string;
}

/**
 * 分派跳窗(Spec 6b §8 畫面 5,root 專屬;同表單的分派):勾租戶 = 分派(`org_workflow`),
 * 取消勾 = 收回。收回後該租戶的新送出會被擋(「流程已移除」),進行中的審核照常走完。
 * 候選 = 根組織的直屬租戶頂層(組織樹上有擁有者的那一層)。
 */
export const AssignWorkflowDialog = ({
  workflow,
  onClose,
  onChanged,
}: AssignWorkflowDialogProps) => {
  const t = useTranslations("admin.workflows.assign");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const showSnackbar = useSnackbar();
  const orgTree = useOrgTreeQuery(session.client);
  const assigned = new Set(
    workflow.assignments.map((item) => item.tenantOrgId),
  );
  const [checked, setChecked] = useState<ReadonlySet<string>>(assigned);
  const [error, setError] = useState<WorkflowError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const assign = useAssignWorkflowToTenantsMutation(session.client);
  const revoke = useRevokeWorkflowFromTenantMutation(session.client);

  const fromTree: TenantOption[] = (orgTree.data?.orgTree ?? []).flatMap(
    (root) =>
      root.children
        .filter(
          (child) =>
            child.ownerUserId !== null && child.ownerUserId !== undefined,
        )
        .map((child) => ({ id: child.id, name: child.name })),
  );
  const fromAssignments: TenantOption[] = workflow.assignments
    .filter(
      (item) => !fromTree.some((tenant) => tenant.id === item.tenantOrgId),
    )
    .map((item) => ({
      id: item.tenantOrgId,
      name: item.tenantName ?? item.tenantOrgId,
    }));
  const tenants = [...fromTree, ...fromAssignments];

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const added = [...checked].filter((id) => !assigned.has(id));
      const removed = [...assigned].filter((id) => !checked.has(id));
      if (added.length > 0) {
        await assign.mutateAsync({
          input: { workflowKey: workflow.key, tenantOrgIds: added },
        });
      }
      for (const tenantOrgId of removed) {
        await revoke.mutateAsync({
          input: { workflowKey: workflow.key, tenantOrgId },
        });
      }
      showSnackbar("success", t("success"));
      onChanged();
    } catch (error_) {
      const parsed = workflowErrorOf(error_);
      setError(parsed);
      showSnackbar("error", tErrors(parsed.code));
      onChanged();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("title", { name: workflow.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => {
              void save();
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body2">{t("body")}</Typography>
        <Stack role="group" aria-label={t("tenants")}>
          {tenants.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("empty")}
            </Typography>
          )}
          {tenants.map((tenant) => (
            <FormControlLabel
              key={tenant.id}
              label={tenant.name}
              control={
                <Checkbox
                  checked={checked.has(tenant.id)}
                  onChange={(_event, isChecked) => {
                    const next = new Set(checked);
                    if (isChecked) {
                      next.add(tenant.id);
                    } else {
                      next.delete(tenant.id);
                    }
                    setChecked(next);
                  }}
                />
              }
            />
          ))}
        </Stack>
        {error !== null && (
          <Alert severity="error">{tErrors(error.code)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
