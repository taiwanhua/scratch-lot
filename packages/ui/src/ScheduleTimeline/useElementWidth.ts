import { useEffect, useRef, useState } from "react";

/**
 * 量元素的內容寬(px,跟著視窗 / 版面變動更新)。量不到時(沒有 `ResizeObserver`
 * 的環境、元素還沒掛上)是 0,由呼叫端退回預設值。
 */
export const useElementWidth = <E extends HTMLElement>() => {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, width };
};
