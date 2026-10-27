import { useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { type WorkflowIssue, isJoinStep } from "@repo/domain/workflow";
import type {
  WorkflowFieldsFragment,
  WorkflowVersionFieldsFragment,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";

import { JsonPreview } from "@/components/base/JsonPreview";
import { useUnsavedGuard } from "@/hooks/base/useUnsavedGuard";
import {
  checkFormKeyOf,
  definitionInputOf,
  definitionOf,
} from "@/lib/base/workflow/definition";
import { isFlowCcIssue, mergeReports } from "@/lib/base/workflow/validation";

import { DesignerPropertyPanel } from "../../DesignerPropertyPanel";
import { useIsDesignerTablet } from "../../useIsDesignerTablet";
import { BackToFlowButton } from "./BackToFlowButton";
import { DesignerToolbar } from "./DesignerToolbar";
import { FlowCanvas } from "./FlowCanvas";
import { FlowCheckPanel } from "./FlowCheckPanel";
import { FlowIssueList } from "./FlowIssueList";
import { FlowSettingsPanel } from "./FlowSettingsPanel";
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
 * 流程設計器本體:流程圖 + 屬性面板 + 檢查器 + JSON 預覽。
 * 檢查器即時跑 `@repo/domain/workflow` 的 `validateWorkflowDefinition`(與 api 同一份),錯誤定位到關卡;
 * 「檢查」鈕另跑 api 的完整檢查、結果面板依關卡列出。「檢查用表單」隨草稿存(`checkFormKey`),
 * 新草稿(`draftRevision === 0`)沒有值時預設第一張綁定的表單;存過的草稿照存的值。
 * 屬性面板沒選關卡時是「整個流程」的設定(整個流程的知會對象)。逾時提醒的時數不合法(`OVERDUE_INVALID`)時擋下不讓存。
 * 存草稿帶 `expectedDraftRevision`。有沒有未存的變更回報給 `useWorkflowDraftStore`
 * (換流程攔截、發布跳窗提示),關分頁 / 重新整理由 `useUnsavedGuard` 問。
 *
 * 平板寬(`useIsDesignerTablet`)時屬性面板是右側抽屜(`DesignerPropertyPanel`):點關卡 / 匯合節點、
 * 按 [整個流程設定] 或點檢查結果時打開;關掉(或點流程圖空白處)= 取消選取,流程圖回到滿寬。
 * 開著時詳情卡片讓出抽屜寬(`DesignerPropertyPanel` 回報),選中的節點跑出可視範圍就平移回來。
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
  const catalog = useDesignerCatalog(workflow.isShared);
  const checkFormFields = useFormFields(checkFormKey, catalog.forms);
  const local = useLocalFlowReport({
    definition,
    isShared: workflow.isShared,
    tenantRoleIds: catalog.tenantRoleIds,
    checkFormKey,
    checkFormFields,
  });
  // 逾時提醒 M ≤ N 或不是正整數:設計器擋下不讓存(api 存草稿照收、發布擋)
  const blockedReason = local.errors.some(
    (issue) => issue.code === "OVERDUE_INVALID",
  )
    ? t("saveBlockedOverdue")
    : null;
  const saving = useWorkflowDraftSave({
    workflowKey: workflow.key,
    initialRevision: draft.draftRevision,
    definition,
    checkFormKey,
    isDirty: state.isDirty,
    blockedReason,
    markSaved: state.markSaved,
    onSaved,
  });
  useUnsavedGuard(state.isDirty);
  const report = useMemo(
    () => mergeReports(local, state.isDirty ? null : saving.serverReport),
    [local, state.isDirty, saving.serverReport],
  );
  const check = useFlowCheck(workflow.key);
  const actions = useFlowActions(state);
  const dataOf = useFlowNodeData(definition, report.errors, catalog.forms);
  const [forkingKey, setForkingKey] = useState<string | null>(null);
  /** 屬性面板(「回到整個流程設定」後把焦點放回這裡) */
  const panelRef = useRef<HTMLElement>(null);
  const isEditable = state.flow !== null;
  const isTablet = useIsDesignerTablet();
  /** 平板寬:抽屜裡顯示整個流程的設定(沒有選關卡時);電腦寬整個流程設定本來就常駐,不看它 */
  const [isFlowSettingsOpen, setFlowSettingsOpen] = useState(false);
  const selected =
    definition.steps.find((step) => step.key === state.selectedKey) ?? null;
  const allIssues = [...report.errors, ...report.warnings];
  const issuesOf = (stepKey: string): WorkflowIssue[] =>
    allIssues.filter((issue) => issue.location.stepKey === stepKey);
  const stepNameOf = (stepKey: string): string =>
    definition.steps.find((step) => step.key === stepKey)?.name ?? stepKey;
  const isDrawerOpen =
    isTablet && isEditable && (selected !== null || isFlowSettingsOpen);
  /** 點檢查結果定位:關卡 → 選它;整個流程的問題(null)在平板寬打開抽屜看整個流程設定 */
  const locate = (stepKey: string | null) => {
    state.select(stepKey);
    setFlowSettingsOpen(stepKey === null && isTablet);
  };
  /** 流程圖上選取:點空白處(null)在平板寬等於關抽屜 */
  const selectOnCanvas = (stepKey: string | null) => {
    state.select(stepKey);
    if (stepKey === null) {
      setFlowSettingsOpen(false);
    }
  };
  /** 回到整個流程設定:平板寬時抽屜留著、改顯示整個流程設定 */
  const backToFlow = () => {
    state.select(null);
    setFlowSettingsOpen(isTablet);
  };
  const closeDrawer = () => {
    state.select(null);
    setFlowSettingsOpen(false);
  };

  const renderPanel = () => {
    if (!isEditable) {
      return null;
    }
    if (selected === null) {
      return (
        <FlowSettingsPanel
          cc={definition.cc ?? null}
          onCcChange={state.setCc}
          selectHint={t("selectHint")}
          issues={allIssues
            .filter((issue) => isFlowCcIssue(issue))
            .map((issue) => issue.message)}
          isShared={workflow.isShared}
          forms={catalog.forms}
          checkFormKey={checkFormKey}
          checkFormFields={checkFormFields}
          isReadonly={false}
        />
      );
    }
    if (isJoinStep(selected)) {
      return (
        <JoinPanel
          key={selected.key}
          join={selected}
          branchCount={actions.branchCountOf(selected.key)}
          issues={issuesOf(selected.key).map((issue) => issue.message)}
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
        key={selected.key}
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
        saveBlockedReason={blockedReason}
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
        onOpenFlowSettings={isTablet && isEditable ? backToFlow : undefined}
      />
      {check.result !== null && (
        <FlowCheckPanel
          result={check.result}
          error={check.error}
          definition={definition}
          checkFormKey={checkFormKey}
          stepNameOf={stepNameOf}
          onLocate={locate}
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
            onSelect={selectOnCanvas}
            isEditable={isEditable}
            onMove={actions.move}
            shouldKeepSelectedInView={isDrawerOpen}
            aria-label={t("canvas")}
          />
        </Box>
        {/* 「回到整個流程設定」按下後按鈕會卸載:焦點移到屬性面板本身(panelRef),不掉回 body */}
        <DesignerPropertyPanel
          label={t("properties")}
          closeLabel={t("closeProperties")}
          isTablet={isTablet}
          isOpen={isDrawerOpen}
          source="designer"
          onClose={closeDrawer}
          panelRef={panelRef}
        >
          <Stack spacing={1}>
            {isEditable && selected !== null && (
              <BackToFlowButton
                onBack={() => {
                  backToFlow();
                  panelRef.current?.focus();
                }}
              />
            )}
            {renderPanel()}
          </Stack>
        </DesignerPropertyPanel>
      </Stack>
      <FlowIssueList
        errors={report.errors}
        warnings={report.warnings}
        stepNameOf={stepNameOf}
        onLocate={locate}
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
