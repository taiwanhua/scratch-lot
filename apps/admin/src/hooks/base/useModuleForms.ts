import { type ModuleFormsQuery, useModuleFormsQuery } from "@repo/graphql";

import { useSession } from "./useSession";

export type ModuleFormSummary = ModuleFormsQuery["moduleForms"][number];

/**
 * 此刻可以在這個模組新增的表單(Spec 6a §3 的交集,api `moduleForms` 已算好):本租戶 `org_form`
 * 啟用中、掛在這個模組、有發布版本。一張 → 新增直接進;多張 → 先選(`FormPicker`)。
 * 停用、收回分派、退役目前版本的表單不在清單裡(歷史提交照常看,只是不能新增)。
 *
 * - `forms`:整份清單(列表的表單篩選、頁籤模板用)
 * - `creatableForms`:其中讀者有新增權限的(api 的 `canCreate`,依表單分開新增權限 B9b);[+ 新增] 與新增頁只用它
 */
export const useModuleForms = (moduleKey: string) => {
  const { session } = useSession();
  const query = useModuleFormsQuery(
    session.client,
    { moduleKey },
    { enabled: moduleKey !== "" },
  );
  const forms = query.data?.moduleForms ?? [];
  return {
    forms,
    creatableForms: forms.filter((form) => form.canCreate),
    isLoading: query.isLoading,
    error: query.error,
  };
};
