import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  useAssignFormToTenantsMutation,
  useOrgTreeQuery,
  useRevokeFormFromTenantMutation,
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
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";

export interface AssignFormDialogProps {
  form: FormFieldsFragment;
  onClose: () => void;
  onChanged: () => void;
}

interface TenantOption {
  id: string;
  name: string;
}

/**
 * 分派跳窗(root 專屬):勾租戶 = 分派(建 `org_form`,預設啟用),
 * 取消勾 = 收回(刪 `org_form`;該租戶不能再新增,歷史提交照常可讀)。
 * 候選 = 根組織的直屬租戶頂層(組織樹上有擁有者的那一層)。
 */
export const AssignFormDialog = ({
  form,
  onClose,
  onChanged,
}: AssignFormDialogProps) => {
  const t = useTranslations("admin.forms.assign");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const showSnackbar = useSnackbar();
  const orgTree = useOrgTreeQuery(session.client);
  const assigned = new Set(form.assignments.map((item) => item.tenantOrgId));
  const [checked, setChecked] = useState<ReadonlySet<string>>(assigned);
  const [error, setError] = useState<FormError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const assign = useAssignFormToTenantsMutation(session.client);
  const revoke = useRevokeFormFromTenantMutation(session.client);

  const fromTree: TenantOption[] = (orgTree.data?.orgTree ?? []).flatMap(
    (root) =>
      root.children
        .filter(
          (child) =>
            child.ownerUserId !== null && child.ownerUserId !== undefined,
        )
        .map((child) => ({ id: child.id, name: child.name })),
  );
  const fromAssignments: TenantOption[] = form.assignments
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
          input: { formKey: form.key, tenantOrgIds: added },
        });
      }
      for (const tenantOrgId of removed) {
        await revoke.mutateAsync({ input: { formKey: form.key, tenantOrgId } });
      }
      showSnackbar("success", t("success"));
      onChanged();
    } catch (error_) {
      const parsed = formErrorOf(error_);
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
      title={t("title", { name: form.name })}
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
