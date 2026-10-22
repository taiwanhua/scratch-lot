import type { Types } from "mongoose";

import { authError } from "../../../auth/auth-error";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import type { AccountsGrant } from "../accounts/accounts-access";
import { notFoundError } from "../accounts/accounts-error";
import type { SettlementLedger, SettlementSnapshot } from "./settlement-ledger";
import {
  type SettlementSideRegistration,
  settlementDocumentOf,
  sideOf,
} from "./settlement-registry";

/**
 * 掛在單據上的收付(`refType` / `settlementSide` 有值)要沖正:除了入口自己的權限,還要**那一邊的收付權限**
 * (登記的 `side.permission`,例 `purchasing.purchase.settle`),兩邊店都看得到的單據還要看得到那一邊的分店。
 * 單據結算區的 [沖正](`reverseLotterySettlement`)與帳戶的交易清單 / 現金流水 [沖正] 用同一個判準。
 */

/**
 * 兩邊店都看得到的單據(`sharedByValues`,調貨單):只能操作自己看得到的那一邊(這一邊的分店在可見範圍內);
 * 其他單據不另外檢查。
 */
export function assertSideVisible(
  operator: OperatorContext,
  snapshot: SettlementSnapshot,
  side: SettlementSideRegistration,
): void {
  const sideBranch =
    side.branchOf?.(snapshot.submission, snapshot.payable) ??
    snapshot.payable.branchOrgId;
  if (
    snapshot.registration.sharedByValues !== undefined &&
    !isOrgVisible(operator, sideBranch)
  ) {
    throw authError("FORBIDDEN", `Side ${side.side} is not visible`);
  }
}

/** 沖正一筆掛在單據上的收付:那一邊要存在、有那一邊的權限、看得到那一邊。回傳單據的收付現況。 */
export async function assertSideReversible(
  operator: OperatorContext,
  ledger: SettlementLedger,
  grant: Pick<AccountsGrant, "has">,
  record: {
    id: string;
    refType: string;
    refId: Types.ObjectId | string;
    settlementSide: string;
  },
): Promise<SettlementSnapshot> {
  const snapshot = await ledger.snapshotOf(
    operator,
    record.refType,
    record.refId,
  );
  const side = sideOf(snapshot.registration, record.settlementSide);
  if (side === undefined) {
    throw notFoundError(`settlement record not found: ${record.id}`);
  }
  if (!grant.has(side.permission)) {
    throw authError("FORBIDDEN", `Missing permission ${side.permission}`);
  }
  assertSideVisible(operator, snapshot, side);
  return snapshot;
}

/**
 * 清單上的 [沖正] 按鈕(不讀單據,只看登記):沒掛單據 → 只看入口權限;掛了單據 → 還要那一邊的收付權限。
 * 看不到那一邊的分店這種情況在送出時由 `assertSideReversible` 擋。
 */
export function canReverseSide(
  grant: Pick<AccountsGrant, "has">,
  record: { refType: string | null; settlementSide: string | null },
): boolean {
  if (record.refType === null || record.settlementSide === null) {
    return true;
  }
  const registration = settlementDocumentOf(record.refType);
  const side =
    registration === undefined
      ? undefined
      : sideOf(registration, record.settlementSide);
  return side !== undefined && grant.has(side.permission);
}
