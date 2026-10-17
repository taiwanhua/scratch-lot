import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { isJoinStep } from "@repo/domain/workflow";
import type {
  WorkflowFieldsFragment,
  WorkflowVersionFieldsFragment,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { JsonPreview } from "@/components/base/JsonPreview";
import { useUnsavedGuard } from "@/hooks/base/useUnsavedGuard";
import {
  checkFormKeyOf,
  definitionInputOf,
  definitionOf,
} from "@/lib/base/workflow/definition";
import { mergeReports } from "@/lib/base/workflow/validation";

import { designerPropertyPanelSx } from "../../designer-layout";
import { DesignerToolbar } from "./DesignerToolbar";
import { FlowCanvas } from "./FlowCanvas";
import { FlowCheckPanel } from "./FlowCheckPanel";
import { FlowIssueList } from "./FlowIssueList";
import { ForkDialog } from "./ForkDialog";
import { JoinPanel } from "./JoinPanel";
import { StepEditor } from "./StepEditor";
import { useDesignerCatalog, useFormFields } from "./useDesignerCatalog";
import { useFlowActions } from "./useFlowActions";
import { useFlowCheck } from "./useFlowCheck";
import { useFlowDesignerState } from "./useFlowDesignerState";
import { useFlowNodeData } from "./useFlowNodeData";
import { useLocalFlowReport } from "./useLocalFlowReport";
import { useWorkflowDraftSave } from "./useWorkflowDraftSave";

export interface FlowDesignerWorkspaceProps {
  workflow: WorkflowFieldsFragment;
  draft: WorkflowVersionFieldsFragment;
  /** 發布過的關卡 key(不能改) */
  lockedKeys: ReadonlySet<string>;
  onSaved: () => void;
  onReload: () => void;
}

/**
 * 流程設計器本體(Spec 6b §8 畫面 3):流程圖 + 屬性面板 + 檢查器 + JSON 預覽。
 * 檢查器即時跑 `@repo/domain/workflow` 的 `validateWorkflowDefinition`(與 api 同一份),錯誤定位到關卡;
 * 「檢查」鈕另跑 api 的完整檢查、結果面板依關卡列出。「檢查用表單」隨草稿存(`checkFormKey`),
 * 新草稿(`draftRevision === 0`)沒有值時預設第一張綁定的表單;存過的草稿照存的值。
 * 存草稿帶 `expectedDraftRevision`。有沒有未存的變更回報給 `useWorkflowDraftStore`
 * (換流程攔截、發布跳窗提示),關分頁 / 重新整理由 `useUnsavedGuard` 問。
 */
export const FlowDesignerWorkspace = ({
  workflow,
  draft,
  lockedKeys,
  onSaved,
  onReload,
}: FlowDesignerWorkspaceProps) => {
  const t = useTranslations("admin.workflows.designer");
  const tOp = useTranslations("admin.workflows.opErrors");
  const initial = useMemo(() => definitionOf(draft), [draft]);
  // 新草稿(還沒存過)才預設第一張綁定的表單;存過的草稿照存的值(存了 null = 明確不指定)
  const state = useFlowDesignerState(
    initial,
    draft.draftRevision === 0
      ? (checkFormKeyOf(draft) ?? workflow.boundForms.at(0)?.formKey ?? null)
      : checkFormKeyOf(draft),
  );
  const { definition, checkFormKey } = state;
  const saving = useWorkflowDraftSave({
    workflowKey: workflow.key,
    initialRevision: draft.draftRevision,
    definition,
    checkFormKey,
    isDirty: state.isDirty,
    markSaved: state.markSaved,
    onSaved,
  });
  useUnsavedGuard(state.isDirty);
  const catalog = useDesignerCatalog(workflow.isShared);
  const checkFormFields = useFormFields(checkFormKey, catalog.forms);
  const local = useLocalFlowReport({
    definition,
    isShared: workflow.isShared,
    tenantRoleIds: catalog.tenantRoleIds,
    checkFormKey,
    checkFormFields,
  });
  const report = useMemo(
    () => mergeReports(local, state.isDirty ? null : saving.serverReport),
    [local, state.isDirty, saving.serverReport],
  );
  const check = useFlowCheck(workflow.key);
  const actions = useFlowActions(state);
  const dataOf = useFlowNodeData(definition, report.errors, catalog.forms);
  const [forkingKey, setForkingKey] = useState<string | null>(null);
  const isEditable = state.flow !== null;
  const selected =
    definition.steps.find((step) => step.key === state.selectedKey) ?? null;
  const issuesOf = (stepKey: string): string[] =>
    [...report.errors, ...report.warnings]
      .filter((issue) => issue.location.stepKey === stepKey)
      .map((issue) => issue.message);
  const stepNameOf = (stepKey: string): string =>
    definition.steps.find((step) => step.key === stepKey)?.name ?? stepKey;

  const renderPanel = () => {
    if (!isEditable) {
      return null;
    }
    if (selected === null) {
      return (
        <Typography variant="body2" color="text.secondary">
          {t("selectHint")}
        </Typography>
      );
    }
    if (isJoinStep(selected)) {
      return (
        <JoinPanel
          key={selected.key}
          join={selected}
          branchCount={actions.branchCountOf(selected.key)}
          issues={issuesOf(selected.key)}
          onRename={(name) => {
            actions.renameJoin(selected.key, name);
          }}
          onAddBranch={() => {
            actions.addBranch(selected.key);
          }}
          onInsertAfter={() => {
            actions.insertAfterJoin(selected.key);
          }}
          onRemoveParallel={() => {
            actions.removeParallel(selected.key);
          }}
        />
      );
    }
    const info = actions.positionInfo(selected.key);
    return (
      <StepEditor
        step={selected}
        onChange={(next) => {
          actions.update(selected.key, next);
        }}
        isKeyLocked={lockedKeys.has(selected.key)}
        isShared={workflow.isShared}
        forms={catalog.forms}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        issues={issuesOf(selected.key)}
        canFork={info.canFork}
        canAddBranch={info.joinKey !== undefined}
        moveOptions={actions.moveOptionsOf(selected.key)}
        onInsertAfter={() => {
          actions.insertAfter(selected.key);
        }}
        onFork={() => {
          setForkingKey(selected.key);
        }}
        onAddBranch={() => {
          if (info.joinKey !== undefined) {
            actions.addBranch(info.joinKey);
          }
        }}
        onShift={(delta) => {
          actions.shift(selected.key, delta);
        }}
        onMove={(target) => {
          actions.move(selected.key, target);
        }}
        onDelete={() => {
          actions.remove(selected.key);
        }}
      />
    );
  };

  return (
    <Stack spacing={2}>
      <DesignerToolbar
        revision={saving.revision}
        isDirty={state.isDirty}
        isSaving={saving.isPending}
        isEditable={isEditable}
        error={saving.error}
        onSave={() => {
          void saving.save();
        }}
        onReload={onReload}
        onAppendStep={actions.appendAtEnd}
        forms={catalog.forms}
        checkFormKey={checkFormKey}
        onCheckFormKeyChange={state.setCheckFormKey}
        onCheck={() => {
          void check.run(definition, checkFormKey, local);
        }}
        isChecking={check.isChecking}
      />
      {check.result !== null && (
        <FlowCheckPanel
          result={check.result}
          error={check.error}
          definition={definition}
          checkFormKey={checkFormKey}
          stepNameOf={stepNameOf}
          onLocate={state.select}
        />
      )}
      {!isEditable && <Alert severity="warning">{t("unparseable")}</Alert>}
      {catalog.isTruncated && (
        <Alert severity="info">{t("catalogTruncated")}</Alert>
      )}
      {state.opError !== null && (
        <Alert severity="warning">{tOp(state.opError)}</Alert>
      )}
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <FlowCanvas
            definition={definition}
            dataOf={dataOf}
            selectedKey={state.selectedKey}
            onSelect={state.select}
            isEditable={isEditable}
            onMove={actions.move}
            aria-label={t("canvas")}
          />
        </Box>
        <Box
          component="section"
          aria-label={t("properties")}
          sx={designerPropertyPanelSx}
        >
          {renderPanel()}
        </Box>
      </Stack>
      <FlowIssueList
        errors={report.errors}
        warnings={report.warnings}
        stepNameOf={stepNameOf}
        onLocate={state.select}
      />
      <JsonPreview
        value={definitionInputOf(definition)}
        label={t("jsonPreview")}
        maxHeight={320}
      />
      {forkingKey !== null && (
        <ForkDialog
          stepName={stepNameOf(forkingKey)}
          onCancel={() => {
            setForkingKey(null);
          }}
          onConfirm={(count) => {
            actions.fork(forkingKey, count);
            setForkingKey(null);
          }}
        />
      )}
    </Stack>
  );
};
