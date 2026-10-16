import { type ReactNode, useRef } from "react";
import { useTranslations } from "use-intl";

import { Snackbar } from "@repo/ui/snackbar";

import { useSnackbarStore } from "@/stores/base/useSnackbarStore";

import { SnackbarAnnouncer } from "./SnackbarAnnouncer";

export interface SnackbarProviderProps {
  children: ReactNode;
}

/**
 * 全站唯一的操作結果提示出口(掛在 `AppProviders`,所以每一頁、每個彈窗都共用同一則)。
 *
 * 狀態本體在 `stores/base/useSnackbarStore`(REACT-02:provider 只做注入與渲染),
 * 送出提示一律經 `hooks/base/useMutationFeedback.ts`。排隊策略(長度 1、只顯示最新一則)
 * 的理由寫在 store 與 `@repo/ui/snackbar` 的 JSDoc。
 *
 * `key` 綁在那一則的 `id` 上:同語氣的連續兩則(接連儲存兩次)要重跑一次進場動畫與
 * 自動關閉計時,否則第二則會沿用第一則剩下的秒數、看起來像「沒有反應」。
 *
 * **彈窗開著時的無障礙(#430)**:MUI Dialog 開啟時會把 app 根節點標 `aria-hidden`,
 * Snackbar 在畫面上看得到、螢幕閱讀器卻念不到。`SnackbarAnnouncer` 在那種時候以一個
 * 視覺隱藏的 `role="status"` 區域補念同一份文案(做法與取捨寫在它的 JSDoc)。
 * `anchorRef` 那個 span 與 Snackbar 同層,用來判斷「Snackbar 現在是不是被藏起來」。
 */
export const SnackbarProvider = ({ children }: SnackbarProviderProps) => {
  const t = useTranslations("admin.app.snackbar");
  const current = useSnackbarStore((state) => state.current);
  const dismiss = useSnackbarStore((state) => state.dismiss);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      {children}
      <span ref={anchorRef} hidden />
      {current !== null && (
        <SnackbarAnnouncer
          key={`announcer-${String(current.id)}`}
          message={current.message}
          anchorRef={anchorRef}
        />
      )}
      {current !== null && (
        <Snackbar
          key={current.id}
          open
          severity={current.severity}
          message={current.message}
          closeLabel={t("close")}
          onClose={dismiss}
        />
      )}
    </>
  );
};
