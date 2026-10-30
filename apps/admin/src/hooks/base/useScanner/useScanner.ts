import { useEffect, useEffectEvent } from "react";

import { type ScanHandler, registerPageScanHandler } from "./scanner-registry";

/**
 * 頁面宣告掃描用途(全域掃描監聽):掛上期間,條碼槍讀到的碼交給 `handler`,
 * 優先於登記的預設處理;同時有兩個頁面宣告時,最後掛上的(目前打開的頁面)優先。
 *
 * ```tsx
 * useScanner("item-lookup", ({ code }) => {
 *   const parsed = parseItemCode(code);
 *   …
 * });
 * ```
 *
 * 判斷門檻、攔截規則與注入見 `scanner-registry.ts` / `scanner-detector.ts`。
 */
export const useScanner = (purpose: string, handler: ScanHandler): void => {
  const onScan = useEffectEvent(handler);
  useEffect(
    () =>
      registerPageScanHandler(purpose, (event) => {
        onScan(event);
      }),
    [purpose],
  );
};
