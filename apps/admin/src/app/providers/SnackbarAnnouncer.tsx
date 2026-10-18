import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Box } from "@repo/ui/box";

export interface SnackbarAnnouncerProps {
  /** 要念的那一則(與畫面上的 Snackbar 同一份文案) */
  message: ReactNode;
  /**
   * 那一則的標題(選填),念在訊息前面。與 `message` 分開傳:兩者都是 store 裡那一則的原值,
   * 參照穩定;在呼叫端組成新的 fragment 會讓每次重繪都換一個值、補念重跑。
   */
  title?: ReactNode;
  /** 與 Snackbar 同一層的定位點:它被標了 `aria-hidden`,就代表 Snackbar 也念不到 */
  anchorRef: RefObject<HTMLElement | null>;
}

/**
 * 視覺隱藏(螢幕閱讀器仍讀得到)的標準寫法。一次性的無障礙樣式,不是設計值(STYLE-06)。
 */
const VISUALLY_HIDDEN_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  border: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/**
 * 彈窗開著時替 Snackbar 補念一次。
 *
 * **為什麼需要**:MUI 的 modal manager 在 Dialog 開啟時把 body 底下**當時存在的**其他節點
 * 全標上 `aria-hidden`,Snackbar 跟著 app 根節點一起被藏,螢幕閱讀器念不到它的 `role="alert"`。
 *
 * **為什麼每一則重新掛一個,而不是常駐一個**:常駐的節點在彈窗開啟那一刻已經存在,一樣會被標
 * `aria-hidden`。每一則提示(provider 以 `key={id}` 換節點)各自 portal 到 body 的**最末端**,
 * 掛上的時間在彈窗開啟之後,modal manager 不會動它。
 *
 * **先空著掛上、下一拍才填字**:live region 要在內容變動**之前**就存在,螢幕閱讀器才會念;
 * 連同內容一起插進來的節點多數閱讀器不念。填字的時機也順便避開「關彈窗 + 跳提示」同一拍時,
 * modal manager 還沒把 `aria-hidden` 拿掉的瞬間。
 *
 * **只在 Snackbar 被藏起來時才填字**:沒有彈窗時 Snackbar 自己的 `role="alert"` 就會被念,
 * 這裡再念一次會重複。
 */
export const SnackbarAnnouncer = ({
  message,
  title,
  anchorRef,
}: SnackbarAnnouncerProps) => {
  const [isAnnounced, setIsAnnounced] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      const isHidden =
        anchorRef.current?.closest('[aria-hidden="true"]') != null;
      if (isHidden) {
        setIsAnnounced(true);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [anchorRef, title, message]);

  return createPortal(
    <Box
      role="status"
      aria-live="polite"
      aria-atomic="true"
      sx={VISUALLY_HIDDEN_SX}
    >
      {isAnnounced && (
        <>
          {title !== undefined && <>{title} </>}
          {message}
        </>
      )}
    </Box>,
    document.body,
  );
};
