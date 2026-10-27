import type { Types } from "mongoose";

/**
 * 上一班的交班 / 日結狀態的登記(規格 6.6 期初零用金:第一班 = 沒有上一班或上一班已被日結涵蓋計算;
 * 其他班 = 上一班「留給下一班」)。
 *
 * - `registerHandoverAmount`:交班結帳(P26)登記「這一班留給下一班多少」;沒登記 = 0
 * - `registerDailyCloseCoverage`:日結(P27)登記「這一班是否已被送出的日結涵蓋計算」;沒登記 = 否
 *
 * 各一個(重複 → 拋錯),回傳撤銷登記的函式;查詢釘在傳入的 `tenantId`。
 */
export type HandoverAmountResolver = (
  tenantId: Types.ObjectId | null,
  shiftId: Types.ObjectId,
) => Promise<number>;

export type DailyCloseCoverageResolver = (
  tenantId: Types.ObjectId | null,
  shiftId: Types.ObjectId,
) => Promise<boolean>;

let handover: HandoverAmountResolver | null = null;
let coverage: DailyCloseCoverageResolver | null = null;

export function registerHandoverAmount(
  next: HandoverAmountResolver,
): () => void {
  if (handover !== null) {
    throw new Error("留給下一班的查詢已登記過");
  }
  handover = next;
  return () => {
    handover = null;
  };
}

export function registerDailyCloseCoverage(
  next: DailyCloseCoverageResolver,
): () => void {
  if (coverage !== null) {
    throw new Error("日結涵蓋的查詢已登記過");
  }
  coverage = next;
  return () => {
    coverage = null;
  };
}

export async function handoverAmountOf(
  tenantId: Types.ObjectId | null,
  shiftId: Types.ObjectId,
): Promise<number> {
  return (await handover?.(tenantId, shiftId)) ?? 0;
}

export async function isCoveredByDailyClose(
  tenantId: Types.ObjectId | null,
  shiftId: Types.ObjectId,
): Promise<boolean> {
  return (await coverage?.(tenantId, shiftId)) ?? false;
}
