import { createParser, useQueryState } from "nuqs";
import { useCallback, useMemo } from "react";

import {
  type UrlStateSchema,
  isSameUrlState,
  parseUrlState,
  serializeUrlState,
  urlStateDefault,
} from "@/lib/base/url-state";

/** 寫入:新值,或由目前的值算出新值(同 `useState` 的 setter)。 */
export type SetUrlState<T> = (next: T | ((current: T) => T)) => void;

/**
 * 頁面狀態存在網址(規格 10.1;frontend-architecture「頁面狀態放網址」):
 * 一個 `key` 一包值,`schema` 驗證並以 `.default(…)` 給預設值。
 *
 * - 網址沒有這個 key、或值被改壞(不合 schema、JSON 壞掉)→ 回預設值,不報錯
 * - 寫回預設值時把 key 從網址拿掉(網址只留跟預設不同的部分)
 * - 寫入用 `replace`:切篩選、換頁不堆瀏覽器上一頁紀錄
 * - 寫入走 react-router 的 navigate(nuqs `shallow: false`):`useLocation` 的讀者(殼、守門)看到的網址
 *   與畫面一致,不會出現「網址列變了、router 還是舊的」
 * - `schema` 請放模組層常數:它的身分變了就重建解析器
 *
 * 新頁面一律用它,不自行讀寫 `useSearchParams`(REACT-14)。
 */
export const useUrlState = <T extends NonNullable<unknown>>(
  key: string,
  schema: UrlStateSchema<T>,
): [T, SetUrlState<T>] => {
  const parser = useMemo(
    () =>
      createParser<T>({
        parse: (raw) => parseUrlState(schema, raw),
        serialize: serializeUrlState,
        eq: isSameUrlState,
      })
        .withDefault(urlStateDefault(schema))
        .withOptions({ shallow: false }),
    [schema],
  );
  const [value, setQueryValue] = useQueryState(key, parser);

  const setValue = useCallback<SetUrlState<T>>(
    (next) => {
      // 有預設值時 nuqs 給的 current 一定是 T(型別上它仍寫成條件型別,泛型下推不開)
      void setQueryValue((current) =>
        typeof next === "function"
          ? (next as (current: T) => T)(current as T)
          : next,
      );
    },
    [setQueryValue],
  );

  return [value, setValue];
};
