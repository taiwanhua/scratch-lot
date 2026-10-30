import {
  type ModuleFormSummary,
  useModuleForms,
} from "@/hooks/base/useModuleForms";

import {
  type FormModuleAccess,
  useFormModuleAccess,
} from "./useFormModuleAccess";

export interface FormEntry {
  /** 模組四頁的路由與模組層的能力(`useFormModuleAccess`)。 */
  access: FormModuleAccess;
  /** 這張表單此刻能不能新增(`creatableForms` 裡有它);停用、收回、沒有新增權限 → undefined。 */
  form: ModuleFormSummary | undefined;
  /** 列表的 [+ 新增] 出不出現:綁了新增頁、且這張表單可新增。 */
  canCreate: boolean;
  /**
   * 這張表單的新增頁網址(`<新增頁路由>/<表單代號>`,可帶 query);沒綁新增頁 → null。
   * 只組網址,不判斷權限:要不要顯示按鈕看 `canCreate` 或呼叫端自己的條件。
   */
  createHref: (search?: URLSearchParams) => string | null;
  /** 模組的表單清單還在載入。 */
  isLoading: boolean;
}

/**
 * 模組裡**指定一張表單**的入口:專案自己換掉表單模組的列表 / 新增頁、但仍走表單引擎存值時,
 * 四頁都以同一個表單代號找表單、判斷能不能新增、組新增頁網址(表單引擎的預設頁則讓使用者挑表單)。
 *
 * ```tsx
 * const entry = useFormEntry("inventory.adjustment", "stock_adjustment");
 * {entry.canCreate && <Button onClick={() => navigate(entry.createHref() ?? "")}>新增</Button>}
 * ```
 */
export const useFormEntry = (moduleKey: string, formKey: string): FormEntry => {
  const access = useFormModuleAccess(moduleKey);
  const { creatableForms, isLoading } = useModuleForms(moduleKey);
  const form = creatableForms.find((item) => item.key === formKey);
  const { createRoute } = access;
  return {
    access,
    form,
    canCreate: createRoute !== null && form !== undefined,
    createHref: (search) => {
      if (createRoute === null) {
        return null;
      }
      const query = search?.toString() ?? "";
      const href = `${createRoute}/${formKey}`;
      return query === "" ? href : `${href}?${query}`;
    },
    isLoading,
  };
};
