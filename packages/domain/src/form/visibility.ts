import { type ComputeInput, computeAll, withHiddenAsNull } from "./compute";
import { evaluateCondition } from "./expression";
import { semanticValuesOf } from "./semantic";
import type { ExpressionContext, FieldDef, StoredValues } from "./types";

/**
 * 顯示條件與計算的收斂(「不能填的四種原因」的第一項:`visibleWhen` 為 false → 清空、不算、不驗)。
 * 前端即時預覽與 api 寫入共用同一套語意:隱藏的欄位在計算輸入裡當 null(明細整欄 null,彙總視為空),
 * 隱藏的計算欄位本身也是 null;條件再以這份值重算,直到哪些欄位隱藏不再改變。
 */

/** 條件求值;沒設或執行期算不出來 → 顯示(形狀錯誤由檢查器在發布前擋下)。 */
function isHiddenBy(
  expr: FieldDef["visibleWhen"],
  input: Parameters<typeof evaluateCondition>[1],
): boolean {
  if (expr === undefined || expr === null) {
    return false;
  }
  try {
    return !evaluateCondition(expr, input);
  } catch {
    return false;
  }
}

/** 以這份存值算出 `visibleWhen` 為 false 的欄位 key。 */
export function hiddenFieldKeysOf(
  fields: readonly FieldDef[],
  values: StoredValues,
  ctx: ExpressionContext,
): Set<string> {
  const input = {
    values: semanticValuesOf(fields, values),
    ctx,
    fields,
    stored: values,
  };
  return new Set(
    fields
      .filter((field) => isHiddenBy(field.visibleWhen, input))
      .map((field) => field.key),
  );
}

const sameKeys = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean =>
  left.size === right.size && [...left].every((key) => right.has(key));

export interface SettledValues {
  /** 收斂後被 `visibleWhen` 隱藏的欄位 key */
  hidden: ReadonlySet<string>;
  /**
   * 會存下的值:隱藏的欄位 null、計算 / 固定值欄位與列內公式子欄以此重算;其餘欄位照傳入的值。
   * 送出時 api 以同一條規則處理「改得動」的欄位,所以前端預覽算出的值 = 後端存的值。
   */
  values: StoredValues;
}

/**
 * 條件與計算一起收斂:第一輪以「不隱藏任何欄位」算出計算欄位再判條件,之後每一輪以
 * 「隱藏 → null、計算欄位以此重算」的值重判,直到隱藏的欄位不變(上限 = 欄位數 + 1,與 api 相同)。
 * 條件可能引用計算欄位、計算欄位又受隱藏影響,所以不能只算一次。
 * 公式引用成圈 → `ComputedCycleError`(同 `computeAll`)。
 */
export function settleHidden(
  fields: readonly FieldDef[],
  input: Omit<ComputeInput, "hidden">,
): SettledValues {
  const { values, ctx } = input;
  let settled: StoredValues = { ...values, ...computeAll(fields, input) };
  let hidden: ReadonlySet<string> = new Set<string>();
  for (let round = 0; round <= fields.length; round += 1) {
    const next = hiddenFieldKeysOf(fields, settled, ctx);
    if (round > 0 && sameKeys(hidden, next)) {
      break;
    }
    hidden = next;
    const base = withHiddenAsNull(values, hidden);
    settled = { ...base, ...computeAll(fields, { values: base, ctx, hidden }) };
  }
  return { hidden, values: settled };
}
