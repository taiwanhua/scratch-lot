import { create } from "zustand";

/**
 * 流程設計器「有沒有未存的變更」(REACT-02:跨元件的用戶端狀態用 zustand;同表單設計器的
 * `useDesignerDraftStore`,各自一份 —— 兩個設計器在不同頁,key 空間也不同)。
 *
 * 設計器在 effect 裡回報;需要它的是別的元件:左清單換流程前要攔下、「設計 / 版本」頁籤切換時提示、
 * 發布跳窗要提示「發布的是上次存的草稿」並提供先存。`save` 成功回新的草稿修訂號、失敗回 null。
 */
export interface WorkflowDraftState {
  workflowKey: string | null;
  isDirty: boolean;
  save: (() => Promise<number | null>) | null;
  report: (
    workflowKey: string,
    isDirty: boolean,
    save: () => Promise<number | null>,
  ) => void;
  /** 設計器卸載時清掉(只清自己那一個的回報) */
  clear: (workflowKey: string) => void;
}

export const INITIAL_WORKFLOW_DRAFT = {
  workflowKey: null,
  isDirty: false,
  save: null,
} as const;

export const useWorkflowDraftStore = create<WorkflowDraftState>()((set) => ({
  ...INITIAL_WORKFLOW_DRAFT,
  report: (workflowKey, isDirty, save) => {
    set({ workflowKey, isDirty, save });
  },
  clear: (workflowKey) => {
    set((state) =>
      state.workflowKey === workflowKey ? INITIAL_WORKFLOW_DRAFT : state,
    );
  },
}));

/** 某個流程的設計器有沒有未存的變更。 */
export const useIsWorkflowDirty = (workflowKey: string): boolean =>
  useWorkflowDraftStore(
    (state) => state.workflowKey === workflowKey && state.isDirty,
  );
