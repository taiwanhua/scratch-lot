import { Types } from "mongoose";

/** 合法的 id 轉 ObjectId;缺席 / 不合法 → null。 */
export function parseId(
  value: string | null | undefined,
): Types.ObjectId | null {
  return value != null && Types.ObjectId.isValid(value)
    ? new Types.ObjectId(value)
    : null;
}

/** 去頭尾空白;空字串 = null。 */
export function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

/** 單筆轉換的結果(轉換一筆一定回一筆)。 */
export function firstOf<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) {
    throw new Error("expected one item");
  }
  return first;
}
