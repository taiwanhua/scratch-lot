import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";

/** 表單模組的四個頁面節點(seed 宣告,Spec 6a §2「seed 宣告(表單模組)」)。 */
export const FORM_MODULE_PAGE_SUFFIXES = {
  viewPage: "view-page",
  createPage: "create-page",
  editPage: "edit-page",
} as const;

export interface FormModuleAccess {
  moduleKey: string;
  listRoute: string | null;
  viewRoute: string | null;
  createRoute: string | null;
  editRoute: string | null;
  /**
   * 綁了新增頁、且有模組 `create`。依表單分開新增權限(B9b)的模組不看模組 `create`:
   * 列表的 [+ 新增] 另外看 `useModuleForms` 的 `creatableForms`(`FormListPage`)。
   */
  canCreate: boolean;
}

/** 隱藏頁的 key(`<模組>.view-page`)→ 模組 key;列表頁本身就是模組 key。 */
export const formModuleKeyOf = (pageKey: string): string => {
  const suffixes: readonly string[] = Object.values(FORM_MODULE_PAGE_SUFFIXES);
  const lastDot = pageKey.lastIndexOf(".");
  return lastDot !== -1 && suffixes.includes(pageKey.slice(lastDot + 1))
    ? pageKey.slice(0, lastDot)
    : pageKey;
};

/**
 * 表單模組預設組裝的「進得去哪、做得了什麼」(同示範家族的 `useDemoAccess`,ADR-0011):
 * 進得去哪一頁看 `me.modules` 有沒有那個模組(路由字串一律從模組陣列取,不寫死);
 * 逐列的編輯 / 刪除看 api 給的 `abilities`,不在這裡。
 */
export const useFormModuleAccess = (moduleKey: string): FormModuleAccess => {
  const me = useMe();
  const { hasPermission } = usePermissions();
  const modules = me.data?.me.modules ?? [];
  const routeOf = (key: string): string | null =>
    modules.find((module) => module.key === key)?.route ?? null;
  const createRoute = routeOf(
    `${moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.createPage}`,
  );

  return {
    moduleKey,
    listRoute: routeOf(moduleKey),
    viewRoute: routeOf(`${moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.viewPage}`),
    createRoute,
    editRoute: routeOf(`${moduleKey}.${FORM_MODULE_PAGE_SUFFIXES.editPage}`),
    canCreate: createRoute !== null && hasPermission(`${moduleKey}.create`),
  };
};
