import { createContext, useContext } from "react";

import {
  type FormModuleOptionsRegistry,
  type ResolvedFormModuleOptions,
  formModuleOptionsOf,
} from "../../lib/base/form-engine/form-module-options";

/**
 * 注入用 context(REACT-02:只注入組裝好的「模組 key → 表單模組設定」唯讀對照表,不承載會變的狀態)。
 * 由 `app/providers/FormModuleOptionsProvider.tsx` 供給;正式 app 與測試都經 `app/providers/RootProviders.tsx` 接線。
 */
export const FormModuleOptionsContext =
  createContext<FormModuleOptionsRegistry | null>(null);

/**
 * 一個表單模組的模組層設定。有 Provider 但沒登記該模組(客製頁自己組裝)→ 預設值;
 * 沒有 Provider 是接線錯誤,直接丟出來,不默默退回預設(否則登記的模板會無聲失效)。
 */
export const useFormModuleOptions = (
  moduleKey: string,
): ResolvedFormModuleOptions => {
  const registry = useContext(FormModuleOptionsContext);
  if (registry === null) {
    throw new Error(
      "useFormModuleOptions must be used within <FormModuleOptionsProvider>",
    );
  }
  return formModuleOptionsOf(registry, moduleKey);
};
