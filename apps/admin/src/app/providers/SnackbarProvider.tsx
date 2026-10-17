import { type ReactNode, useRef } from "react";
import { useTranslations } from "use-intl";

import { SnackbarStack } from "@repo/ui/snackbar";

import { useSnackbarStore } from "@/stores/base/useSnackbarStore";

import { SnackbarAnnouncer } from "./SnackbarAnnouncer";

export interface SnackbarProviderProps {
  children: ReactNode;
}

/**
 * 全站唯一的短提示出口(掛在 `AppProviders`,所以每一頁、每個彈窗都共用同一個堆疊)。
 *
 * 狀態本體在 `stores/base/useSnackbarStore`(REACT-02:provider 只做注入與渲染),
 * 送出提示一律經 `hooks/base/useMutationFeedback.ts`(`useMutationFeedback` / `useSnackbar`)。
 * 位置與堆疊(電腦 / 平板右下、手機底部滿寬;往上疊、新的在下、最多 3 則)寫在
 * `@repo/ui/snackbar` 的 `SnackbarStack` 與 store 的 JSDoc。
 *
 * **彈窗開著時的無障礙(#430)**:MUI Dialog 開啟時會把 app 根節點標 `aria-hidden`,
 * Snackbar 在畫面上看得到、螢幕閱讀器卻念不到。`SnackbarAnnouncer` 在那種時候以一個
 * 視覺隱藏的 `role="status"` 區域補念**最新的那一則**(做法與取捨寫在它的 JSDoc;
 * 以 `key` 綁那一則的 id,每則新提示換一個節點)。
 * `anchorRef` 那個 span 與堆疊同層,用來判斷「提示現在是不是被藏起來」。
 */
export const SnackbarProvider = ({ children }: SnackbarProviderProps) => {
  const t = useTranslations("admin.app.snackbar");
  const items = useSnackbarStore((state) => state.items);
  const latest = useSnackbarStore((state) => state.latest);
  const dismiss = useSnackbarStore((state) => state.dismiss);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      {children}
      <span ref={anchorRef} hidden />
      {latest !== null && (
        <SnackbarAnnouncer
          key={`announcer-${String(latest.id)}`}
          message={latest.message}
          {...(latest.title !== undefined && { title: latest.title })}
          anchorRef={anchorRef}
        />
      )}
      <SnackbarStack
        items={items}
        closeLabel={t("close")}
        onClose={(id) => {
          dismiss(Number(id));
        }}
      />
    </>
  );
};
