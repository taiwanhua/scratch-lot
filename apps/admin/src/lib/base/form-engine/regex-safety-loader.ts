import type { RegexSafetyCheck } from "@repo/domain/form";

/**
 * recheck(`@repo/domain/form-regex-safety`,瀏覽器版約 2.9 MB)的懶載入:模組層 promise 快取,
 * 整個 app 只載一次(DATA-02 的「同一份資料只有一個來源」;不是伺服器資料,所以不進 react-query)。
 * 載入失敗就清掉快取,下次再試。
 */
let pending: Promise<RegexSafetyCheck> | null = null;

export const loadRegexSafety = (): Promise<RegexSafetyCheck> => {
  pending ??= import("@repo/domain/form-regex-safety").then(
    (module) => module.recheckRegexSafety,
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
};
