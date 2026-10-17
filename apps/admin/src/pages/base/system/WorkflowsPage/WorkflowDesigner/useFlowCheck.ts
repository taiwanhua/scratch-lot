import { useState } from "react";

import type {
  WorkflowDefinition,
  WorkflowValidationReport,
} from "@repo/domain/workflow";
import { useValidateWorkflowVersionQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { definitionInputOf } from "@/lib/base/workflow/definition";
import { definitionFingerprint } from "@/lib/base/workflow/flow-model";
import { mergeReports } from "@/lib/base/workflow/validation";
import {
  type WorkflowError,
  workflowErrorOf,
} from "@/lib/base/workflow/workflow-errors";

/** 一次「檢查」的結果(按下當時的定義與檢查用表單)。 */
export interface FlowCheckResult {
  report: WorkflowValidationReport;
  /** 按下時有沒有選檢查用表單(沒選 = 欄位類檢查沒做,結構類照跑) */
  hasCheckForm: boolean;
  /** 按下時的定義指紋:之後又改過就提示「已修改,請重新檢查」 */
  fingerprint: string;
  checkFormKey: string | null;
}

const EMPTY_REPORT: WorkflowValidationReport = { errors: [], warnings: [] };

/**
 * 設計器的「檢查」鈕:把目前的定義與檢查用表單送 api 的 `validateWorkflowVersion`
 * (api 有完整目錄:本租戶的使用者與角色、各表單目前版本),再併入前端即時檢查的結果
 * (同一關同一種問題只列一次)。即時檢查照舊在設計器下方,這裡是按了才跑的完整版。
 */
export const useFlowCheck = (workflowKey: string) => {
  const { session } = useSession();
  const [result, setResult] = useState<FlowCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<WorkflowError | null>(null);

  const run = async (
    definition: WorkflowDefinition,
    checkFormKey: string | null,
    local: WorkflowValidationReport,
  ): Promise<void> => {
    setIsChecking(true);
    setError(null);
    try {
      const payload = await useValidateWorkflowVersionQuery.fetcher(
        session.client,
        {
          input: {
            workflowKey,
            definition: definitionInputOf(definition),
            checkFormKey,
          },
        },
      )();
      setResult({
        report: mergeReports(local, payload.validateWorkflowVersion),
        hasCheckForm: checkFormKey !== null,
        fingerprint: definitionFingerprint(definition),
        checkFormKey,
      });
    } catch (error_) {
      setError(workflowErrorOf(error_));
      setResult({
        report: mergeReports(local, EMPTY_REPORT),
        hasCheckForm: checkFormKey !== null,
        fingerprint: definitionFingerprint(definition),
        checkFormKey,
      });
    } finally {
      setIsChecking(false);
    }
  };

  return { result, isChecking, error, run };
};

export type FlowCheck = ReturnType<typeof useFlowCheck>;
