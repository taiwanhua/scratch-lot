import { useMemo, useState } from "react";

import type { AssigneeSource, WorkflowDefinition } from "@repo/domain/workflow";

import {
  type Flow,
  type FlowOpError,
  definitionFingerprint,
  parseFlow,
  toDefinition,
} from "@/lib/base/workflow/flow-model";
import type { FlowOpResult } from "@/lib/base/workflow/flow-ops";

/** 與上次存檔比對的字串:節點 / 連線排序後比(陣列順序不同但圖一樣 = 沒改),連同整個流程的知會對象。 */
const fingerprintOf = definitionFingerprint;

/**
 * 設計器的編輯狀態:段落串(`flow-model.ts`)、整個流程的知會對象(`cc`,段落串之外的流程層設定)、
 * 「檢查用表單」、選中的節點、上一個被拒絕的操作,與「有沒有未存的變更」
 * (與上次存檔的定義 + 檢查用表單比對,不是比有沒有按過東西)。
 *
 * 草稿的結構表示不了(`parseFlow` 回 null:手改過的 JSON、舊資料)時 `flow` 為 null,
 * 設計器改成唯讀顯示原定義與檢查結果,不去猜使用者要的是什麼。
 */
export const useFlowDesignerState = (
  initial: WorkflowDefinition,
  initialCheckFormKey: string | null,
) => {
  const [flow, setFlow] = useState<Flow | null>(() => parseFlow(initial));
  const [cc, setCc] = useState<AssigneeSource | null>(initial.cc ?? null);
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    fingerprintOf(initial),
  );
  const [checkFormKey, setCheckFormKey] = useState(initialCheckFormKey);
  const [savedCheckFormKey, setSavedCheckFormKey] =
    useState(initialCheckFormKey);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [opError, setOpError] = useState<FlowOpError | null>(null);
  const definition = useMemo(
    () => (flow === null ? initial : { ...toDefinition(flow), cc }),
    [flow, initial, cc],
  );
  const isDirty =
    flow !== null &&
    (fingerprintOf(definition) !== savedFingerprint ||
      checkFormKey !== savedCheckFormKey);

  return {
    flow,
    definition,
    checkFormKey,
    setCheckFormKey,
    /** 改整個流程的知會對象(`null` = 不知會) */
    setCc,
    isDirty,
    selectedKey,
    opError,
    select: (key: string | null) => {
      setSelectedKey(key);
      setOpError(null);
    },
    /** 套用一個操作的結果;被拒就記下原因(畫面顯示),段落串不變 */
    apply: (result: FlowOpResult) => {
      if (!result.ok) {
        setOpError(result.error);
        return;
      }
      setFlow(result.flow);
      setOpError(null);
      if (result.selectedKey !== undefined) {
        setSelectedKey(result.selectedKey);
      }
    },
    /** 直接改段落串(改一關的內容、改匯合名稱這類不會違反形狀的) */
    update: (next: Flow) => {
      setFlow(next);
    },
    markSaved: (saved: WorkflowDefinition, savedCheckForm: string | null) => {
      setSavedFingerprint(fingerprintOf(saved));
      setSavedCheckFormKey(savedCheckForm);
    },
  };
};

export type FlowDesignerState = ReturnType<typeof useFlowDesignerState>;
