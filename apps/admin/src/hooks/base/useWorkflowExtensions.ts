import { type ComponentType, createContext, useContext } from "react";

import type {
  WorkflowDecision,
  WorkflowInstanceFieldsFragment,
  WorkflowTaskFieldsFragment,
} from "@repo/graphql";

/**
 * 依模組登記的審核擴充(`docs/modules/workflows.md`「依模組登記的審核擴充」)。一份登記兩種用途:
 *
 * - `Effect`:寫入成功之後的動作(審核決定被接受、表單送出成功),例:調貨單第一關通過後印出貨單
 * - `Review`:審核畫面的擴充 —— 我的任務上方顯示警告、停用 [核准],例:補打卡「對應的排班已被刪除」
 *
 * 不論審核區塊(`ApprovalSection`)出現在申請中心或模組自己的頁面、送出是在新增頁或引擎的編輯頁,都會生效。
 */

/**
 * 寫入成功之後的事件:
 *
 * - `decided`:我的任務決定被接受(審核區塊的核准 / 駁回 / 退回、申請中心的批次核准);「此關已結束」不算
 * - `submitted`:表單送出成功(新增頁、引擎的編輯頁重新送出);`instanceId` = 送出後的審核實例(沒有流程 = null)
 */
export type WorkflowEffectEvent =
  | {
      kind: "decided";
      moduleKey: string;
      submissionId: string;
      instanceId: string;
      stepKey: string;
      decision: WorkflowDecision;
    }
  | {
      kind: "submitted";
      moduleKey: string;
      submissionId: string;
      instanceId: string | null;
    };

/** `Effect` 元件:每個事件掛一份(在殼層),做完(成功或失敗)呼叫 `onDone` 就卸載。 */
export interface WorkflowEffectProps {
  event: WorkflowEffectEvent;
  onDone: () => void;
}

/** `Review` 回報給審核區塊的畫面狀態(警告文字由 `Review` 元件自己畫在任務上方)。 */
export interface ApprovalReviewState {
  /** true = 這個任務的 [核准] 停用(駁回 / 退回照常) */
  approveDisabled: boolean;
}

/** `Review` 元件:審核區塊替「我的任務」每一筆掛一份,畫在那筆任務的動作鈕上方。 */
export interface ApprovalReviewProps {
  instance: WorkflowInstanceFieldsFragment;
  task: WorkflowTaskFieldsFragment;
  /** 狀態變了就回報(沒回報 = 不停用) */
  onStateChange: (state: ApprovalReviewState) => void;
}

/** 一個模組的審核擴充;兩種都是選填,同一個模組可以有多筆登記。 */
export interface WorkflowExtensionRegistration {
  moduleKey: string;
  Effect?: ComponentType<WorkflowEffectProps>;
  Review?: ComponentType<ApprovalReviewProps>;
}

export interface WorkflowExtensionsValue {
  /** 寫入成功之後通知:這個模組登記的每個 `Effect` 各掛一份去做;沒有就什麼都不做 */
  notify: (event: WorkflowEffectEvent) => void;
  /** 這個模組登記的 `Review` 元件 */
  reviewsOf: (
    moduleKey: string,
  ) => readonly ComponentType<ApprovalReviewProps>[];
}

/**
 * 注入用 context(REACT-02):Provider 在 `app/providers/WorkflowExtensionsProvider.tsx`(掛在殼層);
 * 殼外(沒有 Provider)沒有任何擴充。
 */
export const WorkflowExtensionsContext = createContext<WorkflowExtensionsValue>(
  {
    notify: () => {
      // 殼外(測試單獨掛元件、登入前)沒有動作要做
    },
    reviewsOf: () => [],
  },
);

export const useWorkflowExtensions = (): WorkflowExtensionsValue =>
  useContext(WorkflowExtensionsContext);
