import type { z } from "zod";

/**
 * `useUrlState` 的網址值 ↔ 狀態轉換(純函式,與 nuqs 無關,單獨可測)。
 *
 * 一個網址 key 存一包值:
 * - **字串直接寫**(`?tab=mine`),其餘(物件、數字、布林、陣列)寫 JSON(`?list={"page":2}`)。
 *   字串不包引號是為了讓最常見的頁內分頁網址可讀(Figma BS-15a 的網址列)。
 * - 讀回時先把原字串交給 schema;不通過再當 JSON 解析後交給 schema。兩條都不通過
 *   (被手改壞、舊版格式、JSON 語法錯)就回 `null`,呼叫端退回預設值,不丟錯。
 */

/**
 * `useUrlState` 收的 schema:必須帶 `.default(…)`(型別上就擋掉沒有預設值的 schema)。
 * 頂層不要用「字串與其他型別的 union」或 `z.coerce`:字串原樣寫進網址,讀回時先試原字串,會被當成字串吃掉(REACT-14)。
 */
export type UrlStateSchema<T> = z.ZodDefault<z.ZodType<T>>;

/** 網址值 → 狀態;不合 schema 回 `null`。 */
export const parseUrlState = <T>(
  schema: z.ZodType<T>,
  raw: string,
): T | null => {
  const asString = schema.safeParse(raw);
  if (asString.success) return asString.data;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const asJson = schema.safeParse(json);
  return asJson.success ? asJson.data : null;
};

/** 狀態 → 網址值:字串原樣,其餘 JSON。 */
export const serializeUrlState = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

/** 用序列化結果比較(物件預設是參考相等,回到預設值時才清得掉網址參數)。 */
export const isSameUrlState = (a: unknown, b: unknown): boolean =>
  serializeUrlState(a) === serializeUrlState(b);

/**
 * schema 的預設值 = `schema.parse(undefined)`:schema 自己用 `.default(…)` 宣告。
 * 預設值與驗證放同一處,網址沒有這個 key、或被改壞時都回到它。
 */
export const urlStateDefault = <T>(schema: z.ZodType<T>): T => {
  // eslint-disable-next-line unicorn/no-useless-undefined -- 要的就是「沒有值」時 schema 給的預設值,safeParse 必須收一個參數
  const result = schema.safeParse(undefined);
  if (!result.success) {
    throw new Error(
      "useUrlState 的 schema 必須以 .default(…) 宣告預設值(網址沒有或改壞時退回它)",
    );
  }
  return result.data;
};
