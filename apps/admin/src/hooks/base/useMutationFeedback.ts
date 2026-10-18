import type { ReactNode } from "react";

import { useSnackbarStore } from "@/stores/base/useSnackbarStore";

/**
 * 送一則提示出去:`show(severity, message, { title?, action? })`。給少數自己控制時機的流程、
 * 可撤銷的動作(Success + [撤銷])、新通知提示(Info + 標題、沒有動作)用;mutation 一律走
 * `useMutationFeedback`。各模組不另寫提示元件。
 */
export const useSnackbar = () => useSnackbarStore((state) => state.show);

export interface UseMutationFeedbackOptions<TData, TVariables> {
  /**
   * 成功文案(`<ns>.feedback.<action>Success`)。啟用 / 停用這種「同一個端點兩種說法」
   * 的,給一個吃 payload 的函式。
   *
   * 給 `null`(或函式回 `null`)= **這一步成功不跳提示**,只保留失敗提示。唯一的用途是
   * dry-run / 預覽這種「還沒完成操作」的步驟(`useUserOrgsFlow` 的試算):跳「已更新」
   * 是騙人的,但試算失敗仍然是這次操作失敗,照跳。
   */
  success:
    ReactNode | ((data: TData, variables: TVariables) => ReactNode) | null;
  /**
   * 失敗文案:用**各頁既有的錯誤解讀**,不要在這裡另起一套
   * (`(error) => tErrors(orgManagerErrorOf(error).code)`)。
   *
   * 回 `null` = **失敗不跳提示**:只給「錯誤已經就地顯示在開著的彈窗裡、
   * 使用者正盯著它看」的流程用(複製組織與角色的彈窗),避免同一句話出現兩次。
   */
  error: (error: unknown) => ReactNode;
  /** 呼叫端既有的 onSuccess(DATA-04 的寫回與失效、關彈窗…);本 hook 只包住它,不取代 */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** 呼叫端既有的 onError(表單 / 彈窗內的欄位級錯誤標示照舊留著) */
  onError?: (error: unknown, variables: TVariables) => void;
}

/**
 * 直接塞進 codegen mutation hook 的 options。尾端兩個參數是選填的,所以
 * `mutateAsync` 串多步的流程也能整段完成後自己呼叫一次(見下方 JSDoc)。
 */
export interface MutationFeedback<TData, TVariables> {
  onSuccess: (data: TData, variables?: TVariables, context?: unknown) => void;
  onError: (error: unknown, variables?: TVariables, context?: unknown) => void;
}

/**
 * mutation 的統一回饋(#376):**成功或失敗一律跳一則 Snackbar**。
 *
 * 回傳的 `{ onSuccess, onError }` 直接塞進 codegen mutation hook 的 options;
 * 兩支都**包住**呼叫端原本的 callback 而不是取代它 —— 先跳提示、再執行原本的
 * 快取寫回 / 失效(DATA-04)與關彈窗,所以 #372 的快取行為完全不動:
 *
 * ```ts
 * const setOrgEnabled = useSetOrgEnabledMutation(
 *   session.client,
 *   useMutationFeedback<SetOrgEnabledMutation>({
 *     success: (payload) =>
 *       payload.setOrgEnabled.org.enabled
 *         ? t("feedback.enableSuccess")
 *         : t("feedback.disableSuccess"),
 *     error: (error) => tErrors(orgManagerErrorOf(error).code),
 *     onSuccess: (payload) => {
 *       closeDialog();
 *       void data.invalidate(payload.setOrgEnabled.org.id);
 *     },
 *     onError: onActionError,
 *   }),
 * );
 * ```
 *
 * **失敗時原本的錯誤顯示不拆掉**:彈窗 / 表單裡的欄位級錯誤標示(重複的帳號、
 * 規則編輯器指到的那一條)講的是「哪裡要改」,Snackbar 講的是「這次沒成功」,兩者並存。
 *
 * **一次操作只跳一則**。`mutateAsync` 串多步的流程(`EditOrgDialog` 最多四支 mutation
 * 組成一次「儲存」)不要把 feedback 交給每一支 —— 那會一次跳好幾則。做法是整段
 * try / catch 完成後自己呼叫 `feedback.onSuccess()` / `feedback.onError(error)`。
 *
 * 堆疊規則(往上疊、新的在下、最多 3 則,第 4 則出現時最舊的消失)寫在
 * `stores/base/useSnackbarStore.ts` 與 `@repo/ui/snackbar` 的 JSDoc。
 */
export const useMutationFeedback = <TData = void, TVariables = unknown>({
  success,
  error,
  onSuccess,
  onError,
}: UseMutationFeedbackOptions<TData, TVariables>): MutationFeedback<
  TData,
  TVariables
> => {
  const show = useSnackbarStore((state) => state.show);

  return {
    onSuccess: (data, variables) => {
      // ReactNode 不含函式,所以 `typeof === "function"` 足以分辨「固定文案」與「吃 payload 的文案」
      const message =
        typeof success === "function"
          ? success(data, variables as TVariables)
          : success;
      if (message !== null) {
        show("success", message);
      }
      onSuccess?.(data, variables as TVariables);
    },
    onError: (failure, variables) => {
      const message = error(failure);
      if (message !== null) {
        show("error", message);
      }
      onError?.(failure, variables as TVariables);
    },
  };
};
