import { useEffect } from "react";

/**
 * 有未儲存的變更時,關分頁 / 重新整理先由瀏覽器問一次;**頁內**的離開(切頁籤、換左清單、
 * 按取消)由 `components/base/DiscardChangesDialog` 攔。`beforeunload` 只能由瀏覽器出面,
 * 頁面攔不到那一層,所以兩者一定成對出現。
 *
 * 跨路由群組共用(STRUCT-03):角色管理的權限矩陣與示範家族的表單頁都用這一份,
 * #321 之前各有一份、漂了兩個註解版本。
 */
export const useUnsavedGuard = (isDirty: boolean): void => {
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      globalThis.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty]);
};
