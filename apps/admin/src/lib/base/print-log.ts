import { warn } from "@repo/logger";

/**
 * 自動列印(寫入成功後在背景送出的列印工作)沒送出時只記 log、不打斷使用者的操作(STRUCT-06:admin 的 log 走 `@repo/logger`)。
 * 工作建立之後的失敗(缺紙、代理程式離線…)由「列印失敗」通知告訴要求人,不在這裡。
 */
export const logPrintFailure = (
  message: string,
  detail: Record<string, unknown>,
): void => {
  warn(`[print] ${message}`, detail);
};
