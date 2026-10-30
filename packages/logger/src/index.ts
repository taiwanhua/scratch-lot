/* eslint-disable no-console -- logger 的本業就是輸出到 console,是全 repo 唯一的豁免點 */
export const log = (...args: unknown[]): void => {
  console.log("LOGGER:", ...args);
};

/**
 * 警告:不影響流程、但要留下紀錄的失敗(例:背景的自動列印沒送出)。
 * 只用 `console`,瀏覽器(admin / front)、Node 與 Worker 都能用。
 */
export const warn = (...args: unknown[]): void => {
  console.warn("LOGGER:", ...args);
};
