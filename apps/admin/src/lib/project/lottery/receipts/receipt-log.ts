/**
 * 交易後自動列印失敗時只記 log、不打斷使用者的操作(專案規格原則:列印在交易成功後執行,失敗只記 log)。
 * 列印工作建立之後的失敗(缺紙、代理程式離線…)由底座的「列印失敗」通知告訴要求人,不在這裡。
 *
 * admin 還沒有接 `@repo/logger`(要動底座的依賴與建置前置步驟),先集中在這一支輸出到 console;
 * 接上之後只改這裡。
 */
export const logReceiptPrintFailure = (
  message: string,
  detail: Record<string, unknown>,
): void => {
  // eslint-disable-next-line no-console -- admin 尚未依賴 @repo/logger;失敗只記 log 的唯一出口(見上方說明)
  console.warn(`[receipt] ${message}`, detail);
};
