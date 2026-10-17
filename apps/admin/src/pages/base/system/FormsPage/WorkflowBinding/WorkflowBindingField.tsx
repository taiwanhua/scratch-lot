import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  useBindFormWorkflowMutation,
  useFormWorkflowOptionsQuery,
  useUnbindFormWorkflowMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  isBindingIssue,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";

import { WORKFLOWS_MODULE_KEY } from "../../workflows-permissions";
import { UnbindWorkflowDialog } from "./UnbindWorkflowDialog";
import { UnbindableWorkflows } from "./UnbindableWorkflows";

const NO_WORKFLOW = "";

export interface WorkflowBindingFieldProps {
  form: FormFieldsFragment;
  onChanged: () => void;
}

/**
 * 表單管理的「流程綁定」(Spec 6b §8 畫面 7,租戶管理員;`system.forms.edit`):這張表單送出後走哪個流程。
 *
 * - 下拉只列**可直接綁**的流程 + 「不走流程」;不能直接綁的(共用流程含角色佔位 / 指定使用者、
 *   表單欄位來源對不上)列在下方並寫原因,共用流程的附「建客製流程」捷徑(到流程管理以它為基底建)
 * - 改成「不走流程」先警告:進過審核的單之後再送出會被擋(「此表單的審核流程已移除」)
 * - 綁定指向被收回或不存在的流程 → 標「綁定的流程已失效」(送出一律擋,要換一個或解除)
 */
export const WorkflowBindingField = ({
  form,
  onChanged,
}: WorkflowBindingFieldProps) => {
  const t = useTranslations("admin.forms.binding");
  const tErrors = useTranslations("admin.workflows.errors");
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const { session } = useSession();
  const [isUnbinding, setIsUnbinding] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const options = useFormWorkflowOptionsQuery(session.client, {
    formKey: form.key,
  });
  const items = options.data?.formWorkflowOptions.items ?? [];
  const binding = form.workflowBinding ?? null;
  const onFailure = (failure: unknown) => {
    const parsed = workflowErrorOf(failure);
    const bindingIssues = (parsed.issues ?? []).filter((issue) =>
      isBindingIssue(issue),
    );
    setErrorText(
      bindingIssues.length === 0
        ? tErrors(parsed.code)
        : bindingIssues.map((issue) => issue.detail).join("、"),
    );
  };

  const bind = useBindFormWorkflowMutation(
    session.client,
    useMutationFeedback({
      success: t("bound"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: onChanged,
      onError: onFailure,
    }),
  );
  const unbind = useUnbindFormWorkflowMutation(
    session.client,
    useMutationFeedback({
      success: t("unbound"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: () => {
        setIsUnbinding(false);
        onChanged();
      },
      onError: onFailure,
    }),
  );
  const bindable = items.filter((item) => item.canBind);
  const selectOptions = [
    { value: NO_WORKFLOW, label: t("none") },
    ...bindable.map((item) => ({
      value: item.workflowKey,
      label: item.workflowName,
    })),
  ];
  // 綁著一個已失效(或此刻不能直接綁)的流程:仍列在下拉裡,才看得出現在綁的是誰
  if (
    binding !== null &&
    !selectOptions.some((option) => option.value === binding.workflowKey)
  ) {
    selectOptions.push({
      value: binding.workflowKey,
      label: binding.workflowName ?? binding.workflowKey,
    });
  }
  const workflowsRoute = routeOf(WORKFLOWS_MODULE_KEY);

  return (
    <Stack spacing={1} role="group" aria-label={t("region")}>
      <SelectField
        label={t("label")}
        value={binding?.workflowKey ?? NO_WORKFLOW}
        displayEmpty
        size="small"
        sx={{ maxWidth: 360 }}
        disabled={bind.isPending || unbind.isPending}
        helperText={t("hint")}
        options={selectOptions}
        onChange={(next) => {
          setErrorText(null);
          if (next === (binding?.workflowKey ?? NO_WORKFLOW)) {
            return;
          }
          if (next === NO_WORKFLOW) {
            setIsUnbinding(true);
            return;
          }
          bind.mutate({ input: { formKey: form.key, workflowKey: next } });
        }}
      />
      {binding !== null && !binding.isValid && (
        <Alert severity="warning">{t("invalid")}</Alert>
      )}
      {errorText !== null && <Alert severity="error">{errorText}</Alert>}
      <UnbindableWorkflows
        items={items.filter((item) => !item.canBind)}
        onCreateCustom={
          workflowsRoute === null
            ? null
            : (workflowKey) => {
                void navigate(workflowsRoute, {
                  state: { forkWorkflowKey: workflowKey },
                });
              }
        }
      />
      {isUnbinding && binding !== null && (
        <UnbindWorkflowDialog
          workflowName={binding.workflowName ?? binding.workflowKey}
          isSubmitting={unbind.isPending}
          onCancel={() => {
            setIsUnbinding(false);
          }}
          onConfirm={() => {
            unbind.mutate({ input: { formKey: form.key } });
          }}
        />
      )}
    </Stack>
  );
};
