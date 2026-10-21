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
 * (登記的 `side.permission`,例 `purchasing.purchase.settle`),且那一邊能操作(`isSideSettleable`)。
 * 單據結算區的 [沖正](`reverseLotterySettlement`)與帳戶的交易清單 / 現金流水 [沖正] 用同一個判準。
 */

/**
 * 這一邊能不能操作(收付寫入不放大,ADR-0014):
 * - 兩邊店的單據(`sharedByValues`,調貨單):這一邊的分店要在可見範圍內(只能操作自己那一邊)
 * - 其他單據:單據本身要在可見範圍內(依欄位共用進來的只能看,例 總部建的進貨單給進貨分店看)
 */
export function isSideSettleable(
  operator: OperatorContext,
  snapshot: Pick<SettlementSnapshot, "registration" | "submission">,
  sideBranch: Types.ObjectId,
): boolean {
  return snapshot.registration.sharedByValues === undefined
    ? isOrgVisible(operator, snapshot.submission.orgId)
    : isOrgVisible(operator, sideBranch);
}

/** 記帳 / 沖正前:這一邊要能操作(`isSideSettleable`),不能 → `FORBIDDEN`。 */
export function assertSideVisible(
  operator: OperatorContext,
  snapshot: SettlementSnapshot,
  side: SettlementSideRegistration,
): void {
  const sideBranch =
    side.branchOf?.(snapshot.submission, snapshot.payable) ??
    snapshot.payable.branchOrgId;
  if (!isSideSettleable(operator, snapshot, sideBranch)) {
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
