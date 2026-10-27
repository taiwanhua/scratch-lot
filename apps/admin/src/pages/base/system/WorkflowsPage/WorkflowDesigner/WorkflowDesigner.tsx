import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type WorkflowFieldsFragment,
  useCreateWorkflowVersionDraftMutation,
  useWorkflowVersionQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { definitionOf } from "@/lib/base/workflow/definition";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import { FlowCanvas } from "./FlowCanvas";
import { FlowDesignerWorkspace } from "./FlowDesignerWorkspace";
import { useFlowNodeData } from "./useFlowNodeData";

export interface WorkflowDesignerProps {
  workflow: WorkflowFieldsFragment;
  onChanged: () => void;
}

const NO_ISSUES = [] as const;

/** 唯讀的流程圖不選取節點。 */
const ignoreSelect = (): void => {
  // 分派來的共用流程只能看,沒有屬性面板可開
};

/**
 * 設計頁籤的外層 gate(REACT-08,同表單設計器):有草稿才掛設計器(初始值取一次);沒有草稿時,
 * 改得動的人「開新草稿」(以目前版本為基底;還沒發布過就是空白草稿)。改不動的人(分派來的共用流程)
 * 只看目前版本的流程圖。
 */
export const WorkflowDesigner = ({
  workflow,
  onChanged,
}: WorkflowDesignerProps) => {
  const t = useTranslations("admin.workflows.designer");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [reloadKey, setReloadKey] = useState(0);
  const { canEdit } = workflow.abilities;
  const hasCurrent =
    workflow.currentVersion !== null && workflow.currentVersion !== undefined;
  const draftQuery = useWorkflowVersionQuery(
    session.client,
    { workflowKey: workflow.key },
    { enabled: workflow.hasDraft && canEdit, retry: false },
  );
  const draft = draftQuery.data?.workflowVersion.workflowVersion;
  const baseVersion = draft?.baseVersion ?? null;
  // 已發布過的關卡 key 不能改:以草稿的基底版本為準(沒有基底 = 全新流程,都能改)
  const baseQuery = useWorkflowVersionQuery(
    session.client,
    { workflowKey: workflow.key, version: baseVersion ?? 0 },
    { enabled: baseVersion !== null, retry: false },
  );
  const currentQuery = useWorkflowVersionQuery(
    session.client,
    { workflowKey: workflow.key, version: workflow.currentVersion ?? 0 },
    { enabled: !canEdit && hasCurrent, retry: false },
  );
  const lockedKeys = useMemo(() => {
    const base = baseQuery.data?.workflowVersion.workflowVersion;
    return new Set(
      base === undefined
        ? []
        : definitionOf(base).steps.map((step) => step.key),
    );
  }, [baseQuery.data]);
  const current = currentQuery.data?.workflowVersion.workflowVersion;
  const currentDefinition = useMemo(
    () => (current === undefined ? null : definitionOf(current)),
    [current],
  );
  const readonlyDataOf = useFlowNodeData(
    currentDefinition ?? { steps: [] },
    NO_ISSUES,
    [],
  );
  const createDraft = useCreateWorkflowVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: t("draftCreated"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );

  if (!canEdit) {
    return currentDefinition === null ? (
      <Typography variant="body2" color="textSecondary">
        {t("readonlyEmpty")}
      </Typography>
    ) : (
      <Stack spacing={2}>
        <Alert severity="info">{t("readonlyHint")}</Alert>
        <FlowCanvas
          definition={currentDefinition}
          dataOf={readonlyDataOf}
          selectedKey={null}
          onSelect={ignoreSelect}
          isEditable={false}
          aria-label={t("canvas")}
        />
      </Stack>
    );
  }

  if (!workflow.hasDraft) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2" color="textSecondary">
          {t("noDraft")}
        </Typography>
        <Button
          disabled={createDraft.isPending}
          onClick={() => {
            createDraft.mutate({
              input: {
                workflowKey: workflow.key,
                ...(hasCurrent && { baseVersion: workflow.currentVersion }),
              },
            });
          }}
        >
          {t("newDraft")}
        </Button>
      </Stack>
    );
  }

  if (draftQuery.isLoading || (baseVersion !== null && baseQuery.isLoading)) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (draft === undefined) {
    return (
      <Alert severity="error">
        {tErrors(
          draftQuery.error === null
            ? "NOT_FOUND"
            : workflowErrorOf(draftQuery.error).code,
        )}
      </Alert>
    );
  }

  return (
    <FlowDesignerWorkspace
      key={`${draft.id}:${String(reloadKey)}`}
      workflow={workflow}
      draft={draft}
      lockedKeys={lockedKeys}
      onSaved={onChanged}
      onReload={() => {
        void queryClient
          .invalidateQueries({
            queryKey: useWorkflowVersionQuery.getKey({
              workflowKey: workflow.key,
            }),
          })
          .then(() => {
            setReloadKey((value) => value + 1);
          });
      }}
    />
  );
};
