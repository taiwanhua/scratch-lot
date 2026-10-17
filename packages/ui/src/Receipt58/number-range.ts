export interface NumberRangeFormat {
  /** 每段開頭的前綴(例 `#`);連號的結尾不重複前綴:`#012~016`。 */
  prefix?: string;
  /** 補零到幾位數;預設不補。 */
  digits?: number;
  /** 不連號之間的分隔;預設「、」。 */
  separator?: string;
}

/**
 * 把一串號碼寫成區段:連號以 `~` 連起來,不連號以分隔字隔開(Figma `Draft/Receipt58Range` 80:1509)。
 * 重複的號碼只算一次,順序不拘。例:`[12, 13, 14, 15, 16, 20]` + `{ prefix: "#", digits: 3 }`
 * → `#012~016、#020`。
 */
export const formatNumberRanges = (
  numbers: readonly number[],
  { prefix = "", digits = 0, separator = "、" }: NumberRangeFormat = {},
): string => {
  const sorted = [...new Set(numbers)].toSorted((a, b) => a - b);
  const pad = (value: number) => String(value).padStart(digits, "0");
  const segments: string[] = [];
  let start = 0;
  for (let index = 1; index <= sorted.length; index += 1) {
    const isBreak =
      index === sorted.length || sorted[index] !== (sorted[index - 1] ?? 0) + 1;
    if (!isBreak) continue;
    const first = sorted[start] ?? 0;
    const last = sorted[index - 1] ?? 0;
    segments.push(
      first === last
        ? `${prefix}${pad(first)}`
        : `${prefix}${pad(first)}~${pad(last)}`,
    );
    start = index;
  }
  return segments.join(separator);
};

/** 去重後的筆數(給「(6 筆)」這類說明用)。 */
export const countDistinct = (numbers: readonly number[]): number =>
  new Set(numbers).size;
