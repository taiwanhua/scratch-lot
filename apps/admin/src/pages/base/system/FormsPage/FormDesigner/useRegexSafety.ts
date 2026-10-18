import { useEffect, useMemo, useState } from "react";

import type { FormDefinition, RegexSafetyCheck } from "@repo/domain/form";

import { loadRegexSafety } from "@/lib/base/form-engine/regex-safety-loader";

/** 停止打字多久才檢查(recheck 單次可能花上數百毫秒,每打一個字就跑會卡)。 */
export const REGEX_CHECK_DEBOUNCE_MS = 300;

/**
 * 正則即時檢查的狀態(檢查結果區塊顯示):
 * - `idle`:沒有正則,或全部都檢查完了
 * - `checking`:還在等停手 / 載入 recheck / 檢查中
 * - `failed`:recheck 載不下來 —— 即時檢查略過,存草稿時由 api 檢查
 */
export type RegexCheckStatus = "idle" | "checking" | "failed";

export interface RegexSafetyState {
  regexSafety: RegexSafetyCheck;
  status: RegexCheckStatus;
}

interface Verdicts {
  /** 這批結果對應的正則(依字面排序串起來),用來判斷結果是不是最新的 */
  signature: string;
  safe: ReadonlyMap<string, boolean>;
  failed: boolean;
}

/** 字碼序(正則字面的排序只是為了組出穩定的簽章)。 */
const byCodePoint = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const EMPTY: Verdicts = { signature: "", safe: new Map(), failed: false };

const verdictsOf = (
  signature: string,
  patterns: readonly string[],
  check: RegexSafetyCheck,
): Verdicts => ({
  signature,
  safe: new Map(patterns.map((pattern) => [pattern, check(pattern)])),
  failed: false,
});

/**
 * 設計器即時檢查器的 ReDoS 檢查(正則)。recheck **不進首屏 bundle**:
 * 草稿裡出現 `rules.pattern` 才懶載入;正則改動後停手 300ms 才檢查,過期的結果丟掉。
 * 還沒有結果的正則先當安全(狀態 `checking`),載入失敗顯示警告(狀態 `failed`),
 * 存草稿與發布時 api 以同一顆引擎再驗,不安全的正則一定會被擋下。
 */
export const useRegexSafety = (
  definition: FormDefinition,
): RegexSafetyState => {
  const patterns = useMemo(
    () =>
      [
        ...new Set(
          definition.fields
            .map((field) => field.rules?.pattern ?? "")
            .filter((pattern) => pattern !== ""),
        ),
      ].toSorted(byCodePoint),
    [definition.fields],
  );
  const signature = patterns.join("\n");
  const [verdicts, setVerdicts] = useState<Verdicts>(EMPTY);

  useEffect(() => {
    if (patterns.length === 0) {
      return;
    }
    let isStale = false;
    const timer = setTimeout(() => {
      loadRegexSafety().then(
        (check) => {
          if (!isStale) {
            setVerdicts(verdictsOf(signature, patterns, check));
          }
        },
        () => {
          if (!isStale) {
            setVerdicts({ signature, safe: new Map(), failed: true });
          }
        },
      );
    }, REGEX_CHECK_DEBOUNCE_MS);
    return () => {
      isStale = true;
      clearTimeout(timer);
    };
  }, [patterns, signature]);

  const isCurrent = verdicts.signature === signature;
  let status: RegexCheckStatus = "idle";
  if (patterns.length > 0 && !isCurrent) {
    status = "checking";
  } else if (patterns.length > 0 && verdicts.failed) {
    status = "failed";
  }
  const { safe } = verdicts;
  const regexSafety = useMemo<RegexSafetyCheck>(
    () => (source) => safe.get(source) ?? true,
    [safe],
  );
  return { regexSafety, status };
};
