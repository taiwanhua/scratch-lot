"use client";

import { type RefObject, useEffect } from "react";

/** 把選中的頁籤整個移進捲動區(只動捲動區的 scrollLeft,不捲整頁)。 */
const revealSelectedTab = (scroller: HTMLElement) => {
  const tab = scroller.querySelector<HTMLElement>(
    '[role="tab"][aria-selected="true"]',
  );
  if (tab === null) {
    return;
  }
  const area = scroller.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  if (rect.left < area.left) {
    scroller.scrollLeft += rect.left - area.left;
  } else if (rect.right > area.right) {
    scroller.scrollLeft += rect.right - area.right;
  }
};

/**
 * `scrollable` 模式下,捲動區**寬度變了**就再把選中的頁籤捲進來一次。
 *
 * MUI 自己會在掛載與換頁籤時捲(scrollSelectedIntoView),但那時 ‹ / › 還沒出現:
 * 按鈕要等 IntersectionObserver 回報「放不下」才渲染,一出現捲動區就窄了兩顆按鈕寬,
 * 從網址直接打開最後一個頁籤時它會被擠出可視範圍。按鈕出現 / 消失、視窗縮放都會改變捲動區寬度,
 * 這裡用 ResizeObserver 補捲;使用者自己左右捲時寬度不變,不會被拉回來。
 */
export const useRevealSelectedTab = (
  rootRef: RefObject<HTMLDivElement | null>,
  isEnabled: boolean,
) => {
  useEffect(() => {
    const scroller =
      rootRef.current?.querySelector<HTMLElement>(".MuiTabs-scroller");
    if (!isEnabled || !scroller || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      revealSelectedTab(scroller);
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, [rootRef, isEnabled]);
};
