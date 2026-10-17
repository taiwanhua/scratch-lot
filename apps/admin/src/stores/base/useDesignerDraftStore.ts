import { create } from "zustand";

/**
 * 表單設計器「有沒有未存的變更」(REACT-02:跨元件的用戶端狀態用 zustand)。
 *
 * 設計器(`DesignerWorkspace`)在 effect 裡回報自己的狀態;需要它的是別的元件 ——
 * 表單清單換表單前要攔下、版本面板的發布跳窗要提示「發布的是上次存的草稿」並提供先存。
 * `save` 是設計器自己的「存草稿」,成功回新的草稿修訂號、失敗回 null。同一時間只有一個設計器(右欄只顯示一張表單)。
 */
export interface DesignerDraftState {
  formKey: string | null;
  isDirty: boolean;
  save: (() => Promise<number | null>) | null;
  report: (
    formKey: string,
    isDirty: boolean,
    save: () => Promise<number | null>,
  ) => void;
  /** 設計器卸載時清掉(只清自己那一張的回報) */
  clear: (formKey: string) => void;
}

export const useDesignerDraftStore = create<DesignerDraftState>()((set) => ({
  formKey: null,
  isDirty: false,
  save: null,
  report: (formKey, isDirty, save) => {
    set({ formKey, isDirty, save });
  },
  clear: (formKey) => {
    set((state) =>
      state.formKey === formKey
        ? { formKey: null, isDirty: false, save: null }
        : state,
    );
  },
}));

/** 某張表單的設計器有沒有未存的變更。 */
export const useIsDesignerDirty = (formKey: string): boolean =>
  useDesignerDraftStore((state) => state.formKey === formKey && state.isDirty);
