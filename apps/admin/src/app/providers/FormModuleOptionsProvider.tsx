import type { ReactNode } from "react";

import { FormModuleOptionsContext } from "@/hooks/base/useFormModuleOptions";
import type { FormModuleOptionsRegistry } from "@/lib/base/form-engine/form-module-options";

export interface FormModuleOptionsProviderProps {
  /** 組裝好的「模組 key → 表單模組設定」(`composeFormModuleOptions` 的產物) */
  options: FormModuleOptionsRegistry;
  children: ReactNode;
}

/**
 * 把表單模組設定注入給底下的表單頁(`hooks/base/useFormModuleOptions.ts`)。設定由呼叫端組好傳進來,
 * 這裡不讀任何登記表 —— 不同的組裝(正式 app、測試專案)各給各的,互不影響。
 */
export const FormModuleOptionsProvider = ({
  options,
  children,
}: FormModuleOptionsProviderProps) => (
  <FormModuleOptionsContext.Provider value={options}>
    {children}
  </FormModuleOptionsContext.Provider>
);
