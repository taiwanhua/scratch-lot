import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { isJoinStep } from "@repo/domain/workflow";
import {
  type WorkflowFieldsFragment,
  useCreateWorkflowVersionDraftMutation,
  useWorkflowVersionQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { checkFormKeyOf, definitionOf } from "@/lib/base/workflow/definition";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import { designerPropertyPanelSx } from "../../designer-layout";
import { CheckFormField } from "./CheckFormField";
import { FlowCanvas } from "./FlowCanvas";
import { FlowCheckPanel } from "./FlowCheckPanel";
import { FlowIssueList } from "./FlowIssueList";
import { JoinPanel } from "./JoinPanel";
import { StepEditor } from "./StepEditor";
import { useDesignerCatalog, useFormFields } from "./useDesignerCatalog";
import { useFlowCheck } from "./useFlowCheck";
import { useFlowNodeData } from "./useFlowNodeData";
import { useLocalFlowReport } from "./useLocalFlowReport";

export interface FlowVersionViewerProps {
  workflow: WorkflowFieldsFragment;
  /** 要看的已發布 / 已退役版號 */
  version: number;
  onClose: () => void;
  /** 開了新草稿(清單、版本、草稿都要重查) */
  onChanged: () => void;
}

/** 唯讀:沒有任何改動的出口。 */
const ignore = (): void => {
  // 唯讀檢視不改任何東西
};

/**
 * 以流程設計器**唯讀**打開一個已發布 / 已退役的版本(版本面板「檢視 vN」,`workflowVersion(workflowKey, version)`;
 * 同表單設計器的 `VersionViewer`):節點可選、屬性面板可看不可改,不能拖、不能存;檢查結果可看
 * (即時檢查 + 「檢查」鈕),檢查用表單用那一版存的。旁邊「以此為基底開新草稿」(改得動、沒有草稿、
 * 沒有發布中斷才有;已有草稿只提示)。草稿的設計器由外層照樣掛著,未存變更不丟。
 */
export const FlowVersionViewer = ({
  workflow,
  version,
  onClose,
  onChanged,
}: FlowVersionViewerProps) => {
  const t = useTranslations("admin.workflows.designer");
  const tVersions = useTranslations("admin.workflows.versions");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const query = useWorkflowVersionQuery(
    session.client,
    { workflowKey: workflow.key, version },
    { retry: false },
  );
  const found = query.data?.workflowVersion.workflowVersion;
  const definition = useMemo(
    () => (found === undefined ? { steps: [] } : definitionOf(found)),
    [found],
  );
  const checkFormKey = found === undefined ? null : checkFormKeyOf(found);
  const catalog = useDesignerCatalog(workflow.isShared);
  const checkFormFields = useFormFields(checkFormKey, catalog.forms);
  const report = useLocalFlowReport({
    definition,
    isShared: workflow.isShared,
    tenantRoleIds: catalog.tenantRoleIds,
    checkFormKey,
    checkFormFields,
  });
  const check = useFlowCheck(workflow.key);
  const dataOf = useFlowNodeData(definition, report.errors, catalog.forms);
  const createDraft = useCreateWorkflowVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: tVersions("draftCreated"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: () => {
        onChanged();
        onClose();
      },
    }),
  );
  const { canEdit } = workflow.abilities;
  const canBaseOn = canEdit && !workflow.hasDraft;

  if (query.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (found === undefined) {
    return (
      <Alert severity="error">
        {tErrors(
          query.error === null
            ? "NOT_FOUND"
            : workflowErrorOf(query.error).code,
        )}
      </Alert>
    );
  }

  const selected =
    definition.steps.find((step) => step.key === selectedKey) ?? null;
  const issuesOf = (stepKey: string): string[] =>
    [...report.errors, ...report.warnings]
      .filter((issue) => issue.location.stepKey === stepKey)
      .map((issue) => issue.message);
  const stepNameOf = (stepKey: string): string =>
    definition.steps.find((step) => step.key === stepKey)?.name ?? stepKey;

  const renderPanel = () => {
    if (selected === null) {
      return (
        <Typography variant="body2" color="text.secondary">
          {t("viewingSelectHint")}
        </Typography>
      );
    }
    if (isJoinStep(selected)) {
      return (
        <JoinPanel
          key={selected.key}
          join={selected}
          branchCount={
            (definition.edges ?? []).filter((edge) => edge.to === selected.key)
              .length
          }
          issues={issuesOf(selected.key)}
          onRename={ignore}
          onAddBranch={ignore}
          onInsertAfter={ignore}
          onRemoveParallel={ignore}
          isReadonly
        />
      );
    }
    return (
      <StepEditor
        key={selected.key}
        step={selected}
        onChange={ignore}
        isKeyLocked
        isShared={workflow.isShared}
        forms={catalog.forms}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        isReadonly
        issues={issuesOf(selected.key)}
        canFork={false}
        canAddBranch={false}
        moveOptions={[]}
        onInsertAfter={ignore}
        onFork={ignore}
        onAddBranch={ignore}
        onShift={ignore}
        onMove={ignore}
        onDelete={ignore}
      />
    );
  };

  return (
    <Stack
      spacing={2}
      component="section"
      aria-label={t("viewing", { version })}
    >
      <Alert severity="info">{t("viewingHint", { version })}</Alert>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
      >
        <CheckFormField
          forms={catalog.forms}
          value={checkFormKey}
          onChange={ignore}
          isDisabled
          onCheck={() => {
            void check.run(definition, checkFormKey, report);
          }}
          isChecking={check.isChecking}
        />
        <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
          {canBaseOn && (
            <Button
              variant="outlined"
              size="small"
              disabled={createDraft.isPending}
              onClick={() => {
                createDraft.mutate({
                  input: { workflowKey: workflow.key, baseVersion: version },
                });
              }}
            >
              {tVersions("baseOnViewing", { version })}
            </Button>
          )}
          <Button variant="text" size="small" onClick={onClose}>
            {t("closeViewing")}
          </Button>
        </Stack>
      </Stack>
      {canEdit && workflow.hasDraft && (
        <Typography variant="caption" color="text.secondary">
          {t("viewingHasDraft")}
        </Typography>
      )}
      {check.result !== null && (
        <FlowCheckPanel
          result={check.result}
          error={check.error}
          definition={definition}
          checkFormKey={checkFormKey}
          stepNameOf={stepNameOf}
          onLocate={setSelectedKey}
        />
      )}
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <FlowCanvas
            definition={definition}
            dataOf={dataOf}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            isEditable={false}
            aria-label={t("viewingCanvas", { version })}
          />
        </Box>
        <Box
          component="section"
          aria-label={t("viewingProperties")}
          sx={designerPropertyPanelSx}
        >
          {renderPanel()}
        </Box>
      </Stack>
      <FlowIssueList
        errors={report.errors}
        warnings={report.warnings}
        stepNameOf={stepNameOf}
        onLocate={setSelectedKey}
      />
    </Stack>
  );
};
