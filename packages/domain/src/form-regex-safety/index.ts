import { checkSync } from "recheck";

import { PATTERN_FLAGS, type RegexSafetyCheck } from "../form/validate-fields";

/**
 * `@repo/domain/form-regex-safety` 的出口檔(bunchee 由 `exports` 名反推本檔;GEN-01 的 packages 邊界例外)。
 *
 * 表單定義檢查器的 ReDoS 檢查。**與 `@repo/domain/form` 分開一個子路徑**:
 * recheck 的瀏覽器版約 2.9 MB,放在 `form` 裡,admin 只要用到渲染器或值的正規化就會把它打進首屏 bundle。
 * 所以 `validateDefinition` 的 `regexSafety` 一律由呼叫端注入:api 直接 import 本檔,
 * admin 的設計器以動態 `import()` 懶載入。
 */

/** recheck 在 node 端選同步後端的環境變數(它只認這個,沒有程式內參數)。 */
const RECHECK_SYNC_BACKEND = "RECHECK_SYNC_BACKEND";

/**
 * 以 recheck 的**純 JS 後端**同步執行 `fn`。
 *
 * recheck 在 node 的 `checkSync` 預設走 synckit:另開 worker、優先 spawn 原生執行檔或 java,
 * 主執行緒以 `Atomics.wait` 等結果 —— api 每檢查一條正則就可能卡住最多一個逾時。
 * 同步後端只能用環境變數 `RECHECK_SYNC_BACKEND` 選(`lib/main.js` 每次呼叫時讀),
 * 所以在呼叫前暫時設成 `pure`、呼叫後還原,不影響行程裡其他人的設定。
 * 瀏覽器版(`lib/browser.js`)本來就只有純 JS,沒有 `process` 時直接呼叫。
 */
function withPureRecheck<T>(fn: () => T): T {
  if (typeof process === "undefined") {
    return fn();
  }
  const previous = process.env[RECHECK_SYNC_BACKEND];
  process.env[RECHECK_SYNC_BACKEND] = "pure";
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, RECHECK_SYNC_BACKEND);
    } else {
      process.env[RECHECK_SYNC_BACKEND] = previous;
    }
  }
}

/**
 * 預設的 ReDoS 檢查:`recheck`(固定純 JS 後端,見 `withPureRecheck`)判定為 `safe` 才算安全;
 * `vulnerable` 與「判不出來」(`unknown`,含逾時)都視為不安全 — 寧可請設計者改寫,也不讓 API 冒險。
 */
export const recheckRegexSafety: RegexSafetyCheck = (source) =>
  withPureRecheck(
    () => checkSync(source, PATTERN_FLAGS, { timeout: 2000 }).status,
  ) === "safe";
