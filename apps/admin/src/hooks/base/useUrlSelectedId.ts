import { useCallback } from "react";
import { z } from "zod";

import { useUrlState } from "./useUrlState";

/**
 * 目前打開的那一筆(主從版面右欄的詳情)存在網址的預設 key:`?detail=<id>`(REACT-14 的「打開的詳情」)。
 * 不用 `view`:mock 開發模式以 `?view=tenant` 切視角(`mock/browser.ts`),同名會把視角當成 id。
 */
export const DETAIL_URL_KEY = "detail";

/** 沒選 = 空字串(網址不寫這個 key),由呼叫端退回自己的預設(第一筆、樹根…)。 */
const selectedIdSchema = z.string().default("");

/**
 * 主從版面「選中的那一筆」:網址有值 → 那個 id;沒有 → `null`(呼叫端退回預設的那一筆,不寫回網址)。
 * 網址上的 id 不存在(被刪了、換了組織)時一樣由呼叫端退回預設,這裡不驗證 id 是否存在。
 */
export const useUrlSelectedId = (
  key: string = DETAIL_URL_KEY,
): [string | null, (id: string | null) => void] => {
  const [value, setValue] = useUrlState(key, selectedIdSchema);
  const select = useCallback(
    (id: string | null) => {
      setValue(id ?? "");
    },
    [setValue],
  );
  return [value === "" ? null : value, select];
};
