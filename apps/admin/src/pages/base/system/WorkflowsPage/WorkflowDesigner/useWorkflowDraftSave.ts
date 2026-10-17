import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { WorkflowDefinition } from "@repo/domain/workflow";
import {
  type WorkflowValidationFieldsFragment,
  useSaveWorkflowVersionDraftMutation,
} from "@repo/graphql";

import {
  useMutationFeedback,
  useSnackbar,
} from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { definitionInputOf } from "@/lib/base/workflow/definition";
import {
  type WorkflowError,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";
import { useWorkflowDraftStore } from "@/stores/base/useWorkflowDraftStore";

export interface WorkflowDraftSaveInput {
  workflowKey: string;
  initialRevision: number;
  definition: WorkflowDefinition;
  /** 設計器的「檢查用表單」(一併存進草稿) */
  checkFormKey: string | null;
  isDirty: boolean;
  /** 設計器擋下不讓存的原因(例:逾時提醒的時數不合法);null = 可以存 */
  blockedReason: string | null;
  markSaved: (saved: WorkflowDefinition, checkFormKey: string | null) => void;
  onSaved: () => void;
}

/**
 * 流程設計器的「存草稿」:帶 `expectedDraftRevision`(= 讀到或上次存完的 `draftRevision`),
 * 不符 → `CONFLICT`(`DRAFT_REVISION_MISMATCH`),畫面提示「已被別人更新,請重新載入」。
 * 並把「有沒有未存的變更 + 怎麼存」回報給 `useWorkflowDraftStore`(換流程攔截、發布跳窗先存都走同一支)。
 * 有 `blockedReason`(設計器擋下的錯誤)時不送出,跳提示並回 null —— 三個入口(存草稿鈕、換流程、發布前先存)一致。
 */
export const useWorkflowDraftSave = ({
  workflowKey,
  initialRevision,
  definition,
  checkFormKey,
  isDirty,
  blockedReason,
  markSaved,
  onSaved,
}: WorkflowDraftSaveInput) => {
  const t = useTranslations("admin.workflows.designer");
  const tErrors = useTranslations("admin.workflows.errors");
  const { session } = useSession();
  const [revision, setRevision] = useState(initialRevision);
  const [error, setError] = useState<WorkflowError | null>(null);
  const [serverReport, setServerReport] =
    useState<WorkflowValidationFieldsFragment | null>(null);
  const mutation = useSaveWorkflowVersionDraftMutation(session.client);
  const feedback = useMutationFeedback<unknown>({
    success: t("saved"),
    error: (failure) => tErrors(workflowErrorOf(failure).code),
  });
  const showSnackbar = useSnackbar();
  const report = useWorkflowDraftStore((state) => state.report);
  const clear = useWorkflowDraftStore((state) => state.clear);

  const save = async (): Promise<number | null> => {
    const snapshot = definition;
    const checkFormSnapshot = checkFormKey;
    setError(null);
    if (blockedReason !== null) {
      showSnackbar("error", blockedReason);
      return null;
    }
    try {
      const payload = await mutation.mutateAsync({
        input: {
          workflowKey,
          expectedDraftRevision: revision,
          definition: definitionInputOf(snapshot, checkFormSnapshot),
        },
      });
      const saved = payload.saveWorkflowVersionDraft;
      setRevision(saved.workflowVersion.draftRevision);
      setServerReport(saved.validation ?? null);
      markSaved(snapshot, checkFormSnapshot);
      feedback.onSuccess(payload);
      onSaved();
      return saved.workflowVersion.draftRevision;
    } catch (error_) {
      setError(workflowErrorOf(error_));
      feedback.onError(error_);
      return null;
    }
  };

  // store 裡放身分穩定的包裝(永遠呼叫最新一版的 save),否則每次 render 都回報新函式 → 無限重繪
  const latestSave = useRef(save);
  useEffect(() => {
    latestSave.current = save;
  });
  const stableSave = useCallback(() => latestSave.current(), []);
  useEffect(() => {
    report(workflowKey, isDirty, stableSave);
  }, [report, workflowKey, isDirty, stableSave]);
  useEffect(
    () => () => {
      clear(workflowKey);
    },
    [clear, workflowKey],
  );

  return {
    revision,
    save,
    isPending: mutation.isPending,
    error,
    serverReport,
  };
};
