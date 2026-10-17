import { useModuleForms } from "./useModuleForms";

/**
 * 這張表單的這一版是不是**目前版本**(`moduleForms` 的 `currentVersion`)。
 * 查不到(停用、收回分派、還在載入)一律當「不是」—— 呼叫端據此做的事要能安全地不做,
 * 例:表單分區收合紀錄只在渲染目前版本時才清掉已不存在的分區(看舊版本不能清掉新版本的紀錄)。
 */
export const useIsCurrentFormVersion = (
  moduleKey: string,
  formKey: string,
  version: number | null,
): boolean => {
  const { forms } = useModuleForms(moduleKey);
  return (
    version !== null &&
    forms.some(
      (form) => form.key === formKey && form.currentVersion === version,
    )
  );
};
