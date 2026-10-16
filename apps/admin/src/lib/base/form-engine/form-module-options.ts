import { DEFAULT_TAB_LABEL_TEMPLATE } from "./tab-label";

/**
 * 表單模組的**模組層**設定(`app/base/module-pages.ts`、`app/project/module-pages.ts` 的 `forms` 登記時給)。
 * 目前只有頁籤 / 標題模板:套摘要槽,表單自己的 `tabLabelTemplate` 可覆寫(Spec 6a §8「其他」)。
 *
 * 本檔只有型別與純合成:沒有模組層的可變狀態,同一個程序裡合成幾次、結果互不相干。
 * 合成結果由 `app/providers/RootProviders.tsx` 經 `FormModuleOptionsProvider` 注入,頁面以 `hooks/base/useFormModuleOptions.ts` 讀。
 */
export interface FormModuleOptions {
  tabLabelTemplate?: string;
}

/** 一個表單模組的設定登記;`options` 省略 = 全部用預設。 */
export interface FormModuleOptionsEntry {
  readonly moduleKey: string;
  readonly options?: FormModuleOptions;
}

/** 補齊預設值之後的設定(讀的一方不必再判斷有沒有給)。 */
export type ResolvedFormModuleOptions = Readonly<Required<FormModuleOptions>>;

/** 模組 key → 設定。 */
export type FormModuleOptionsRegistry = ReadonlyMap<
  string,
  ResolvedFormModuleOptions
>;

/** 沒登記、或登記時沒給的欄位用它。 */
export const DEFAULT_FORM_MODULE_OPTIONS: ResolvedFormModuleOptions =
  Object.freeze({ tabLabelTemplate: DEFAULT_TAB_LABEL_TEMPLATE });

/**
 * 登記清單 → 「模組 key → 設定」。空 key、同一個 key 登記兩次都拒絕(後者不以先後決定勝者);
 * 沒給模板的沿用預設模板。不修改輸入,每次呼叫回一份新的唯讀對照表。
 */
export const composeFormModuleOptions = (
  entries: readonly FormModuleOptionsEntry[],
): FormModuleOptionsRegistry => {
  const registry = new Map<string, ResolvedFormModuleOptions>();
  for (const { moduleKey, options } of entries) {
    if (moduleKey.trim() === "") {
      throw new Error("表單模組設定的模組 key 不可為空");
    }
    if (registry.has(moduleKey)) {
      throw new Error(`表單模組設定重複登記:模組 key「${moduleKey}」`);
    }
    registry.set(
      moduleKey,
      Object.freeze({
        tabLabelTemplate:
          options?.tabLabelTemplate ??
          DEFAULT_FORM_MODULE_OPTIONS.tabLabelTemplate,
      }),
    );
  }
  return registry;
};

/** 查一個模組的設定;沒登記的模組(客製頁自己組裝、沒走 `forms`)回預設。 */
export const formModuleOptionsOf = (
  registry: FormModuleOptionsRegistry,
  moduleKey: string,
): ResolvedFormModuleOptions =>
  registry.get(moduleKey) ?? DEFAULT_FORM_MODULE_OPTIONS;
