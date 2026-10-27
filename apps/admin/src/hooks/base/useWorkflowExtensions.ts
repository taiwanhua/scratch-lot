import { type ComponentType, createContext, useContext } from "react";

import type {
  FormSubmissionFieldsFragment,
  WorkflowDecision,
  WorkflowInstanceFieldsFragment,
  WorkflowTaskFieldsFragment,
} from "@repo/graphql";

/**
 * 依模組登記的審核擴充(`docs/modules/workflows.md`「依模組登記的審核擴充」)。一份登記三種用途:
 *
 * - `Effect`:寫入成功之後的動作(審核決定被接受、表單送出成功),例:單據在某一關通過後自動列印
 * - `Review`:審核畫面的擴充 —— 我的任務上方顯示警告、停用 [核准],例:審核的資料引用的東西已被刪除
 * - `Section`:申請中心詳情頁的表單專屬區塊(快照下方、審核區塊上方),例:審核這一關要在畫面上操作的東西
 *
 * `Effect`、`Review` 不論審核區塊(`ApprovalSection`)出現在申請中心或模組自己的頁面、送出是在新增頁或
 * 引擎的編輯頁,都會生效;`Section` 只畫在申請中心詳情頁(模組自己的頁面自己畫)。
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

/**
 * `Section` 元件:申請中心詳情頁在審核實例是單據目前的實例時掛一份(看舊修訂的實例不畫),
 * 畫在快照下方、審核區塊上方。
 */
export interface ApplyCenterSectionProps {
  instance: WorkflowInstanceFieldsFragment;
  /** 單據目前的內容(= 這個實例審的修訂) */
  submission: FormSubmissionFieldsFragment;
}

/** 一個模組的審核擴充;三種都是選填,同一個模組可以有多筆登記。 */
export interface WorkflowExtensionRegistration {
  moduleKey: string;
  Effect?: ComponentType<WorkflowEffectProps>;
  Review?: ComponentType<ApprovalReviewProps>;
  Section?: ComponentType<ApplyCenterSectionProps>;
}

export interface WorkflowExtensionsValue {
  /** 寫入成功之後通知:這個模組登記的每個 `Effect` 各掛一份去做;沒有就什麼都不做 */
  notify: (event: WorkflowEffectEvent) => void;
  /** 這個模組登記的 `Review` 元件 */
  reviewsOf: (
    moduleKey: string,
  ) => readonly ComponentType<ApprovalReviewProps>[];
  /** 這個模組登記的 `Section` 元件(申請中心詳情頁) */
  sectionsOf: (
    moduleKey: string,
  ) => readonly ComponentType<ApplyCenterSectionProps>[];
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
    sectionsOf: () => [],
  },
);

export const useWorkflowExtensions = (): WorkflowExtensionsValue =>
  useContext(WorkflowExtensionsContext);
