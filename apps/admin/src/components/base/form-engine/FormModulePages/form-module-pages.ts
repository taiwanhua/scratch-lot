import { type ComponentType, lazy } from "react";

import type { ModulePageProps } from "@/lib/base/module-tree";

import { FORM_MODULE_PAGE_SUFFIXES } from "./useFormModuleAccess";

/**
 * 四頁各自懶載入(`React.lazy`,Suspense 在 `ModuleRoute`):表單引擎(渲染器、JSONLogic / decimal 計算器、
 * widget)只有進到表單模組才需要,不進首屏 bundle。模組層常數,身分固定(不在 render 內建立)。
 */
const FormListPage = lazy(() =>
  import("./FormListPage").then((module) => ({ default: module.FormListPage })),
);
const FormViewPage = lazy(() =>
  import("./FormViewPage").then((module) => ({ default: module.FormViewPage })),
);
const FormCreatePage = lazy(() =>
  import("./FormCreatePage").then((module) => ({
    default: module.FormCreatePage,
  })),
);
const FormEditPage = lazy(() =>
  import("./FormEditPage").then((module) => ({ default: module.FormEditPage })),
);

/** 表單模組四頁在登記表裡的 key:列表頁就是模組 key,其餘三頁是 `<模組 key>.<頁>`(seed 宣告的隱藏頁)。 */
export interface FormModulePageKeys {
  readonly list: string;
  readonly viewPage: string;
  readonly createPage: string;
  readonly editPage: string;
}

export const formModulePageKeys = (moduleKey: string): FormModulePageKeys => ({
  list: moduleKey,
  viewPage: `${moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.viewPage}`,
  createPage: `${moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.createPage}`,
  editPage: `${moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.editPage}`,
});

/**
 * 表單模組的預設組裝(`docs/concepts/form-engine.md`「前端:引擎零件與預設組裝」):產出四個 key 的預設元件。純函式,只回傳、不登記任何東西;
 * 登記在 `app/base/module-pages.ts`、`app/project/module-pages.ts` 的 `forms`(模組層設定也在那裡給),
 * 由 `app/module-page-registry.ts` 展開。單頁客製用該筆登記的 `pageOverrides`,其餘沿用這裡的預設。
 *
 * 四個元件都是模組層常數(不是每次呼叫各建一份,REACT-09 的同一個理由);它們從 `module.key` 反推模組 key,
 * 模組層設定(頁籤模板)執行時以 `useFormModuleOptions` 讀。客製頁把表單零件(`FormRenderer`、
 * `FormSubmissionList`…)綁進自己的版面即可。
 */
export const formModulePages = (
  moduleKey: string,
): Record<string, ComponentType<ModulePageProps>> => {
  const keys = formModulePageKeys(moduleKey);
  return {
    [keys.list]: FormListPage,
    [keys.viewPage]: FormViewPage,
    [keys.createPage]: FormCreatePage,
    [keys.editPage]: FormEditPage,
  };
};
