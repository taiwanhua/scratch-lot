import { CASH_POINT_NAME_MAX_LENGTH } from "@repo/domain/project/lottery-master-data";

import type { LotteryCashPoint } from "../../database/lottery-cash-points/lottery-cash-point.schema";
import { type GameFieldErrors, checkNote } from "../games/game-validation";
import type { UpdateLotteryCashPointInput } from "./dto/lottery-cash-point.input";

/** 編輯時看得到的欄位快照(比對「有沒有改」與稽核的 before 都用它)。 */
export type CashPointSnapshot = Record<string, unknown>;

export function cashPointSnapshotOf(
  cashPoint: LotteryCashPoint,
): CashPointSnapshot {
  return {
    positionKey: cashPoint.positionKey,
    name: cashPoint.name,
    order: cashPoint.order,
    enabled: cashPoint.enabled,
    printerId: cashPoint.printerId ?? null,
    note: cashPoint.note ?? null,
  };
}

/** 名稱:必填、30 字內。 */
export function checkCashPointName(
  value: string,
  errors: GameFieldErrors,
): string | null {
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > CASH_POINT_NAME_MAX_LENGTH
    ? errors.add("name")
    : trimmed;
}

/** 排序:0 以上的整數。 */
export function checkCashPointOrder(
  value: number,
  errors: GameFieldErrors,
): number {
  if (!Number.isInteger(value) || value < 0) {
    errors.add("order");
    return 0;
  }
  return value;
}

/**
 * 編輯 input 裡不必查資料庫的欄位 → 要寫的值(GQL-06:缺席 = 不動;`name` / `order` / `enabled`
 * 送 null 視同缺席;`note` 送 null = 清空)。崗位與印表機要查資料庫,由 service 自己驗。
 */
export function requestedCashPointValues(
  input: UpdateLotteryCashPointInput,
  errors: GameFieldErrors,
): CashPointSnapshot {
  const next: CashPointSnapshot = {};
  if (input.name != null) {
    next.name = checkCashPointName(input.name, errors);
  }
  if (input.order != null) {
    next.order = checkCashPointOrder(input.order, errors);
  }
  if (input.enabled != null) {
    next.enabled = input.enabled;
  }
  if (input.note !== undefined) {
    next.note = checkNote(input.note, errors);
  }
  return next;
}
