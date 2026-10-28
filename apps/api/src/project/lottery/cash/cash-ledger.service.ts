import { Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import {
  type CashMovementType,
  type CashPlace,
  type WithdrawReason,
  isCashRouteAllowed,
} from "@repo/domain/project/lottery-accounts";

import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import { currentSession } from "../../../database/transaction";
import {
  type LotteryCashMovementDocument,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import {
  ACCOUNTS_REASONS,
  FieldErrors,
  isDuplicateKeyError,
  notFoundError,
  validationError,
} from "../accounts/accounts-error";
import { SettlementMarks } from "../settlement/settlement-marks";

export type CashMovementRecord = Persisted<LotteryCashMovementDocument>;

/** 寫一筆現金流水(`recordCashMovement` 的輸入;寫入者以 `operator` 記)。 */
export interface CashMovementInput {
  /** 寫入者(基礎欄位 `createdBy`;可見範圍要含 `orgId`)。 */
  operator: OperatorContext;
  /** 現金所在的分店。 */
  orgId: Types.ObjectId;
  type: CashMovementType;
  from: CashPlace;
  to: CashPlace;
  amount: number;
  /** 缺席 = 現在。 */
  occurredAt?: Date;
  /** 出庫必填。 */
  reason?: WithdrawReason | null;
  /** 抽屜那一端的收銀點與發生班次(任一端是抽屜時必填)。 */
  cashPointId?: Types.ObjectId | null;
  shiftId?: Types.ObjectId | null;
  /** 現金更正的歸屬班次。 */
  attributedShiftId?: Types.ObjectId | null;
  /** 事後更正:發生班次已送出交班結帳 → 那一班(規格 6.12)。 */
  postCloseOf?: Types.ObjectId | null;
  refType?: string | null;
  refId?: Types.ObjectId | null;
  refRevision?: number | null;
  settlementSide?: string | null;
  payee?: string | null;
  note?: string | null;
  /** 存銀行連到的銀行「存入」。 */
  bankTransactionId?: Types.ObjectId | null;
}

/** 小金庫的起算點:最近一次已完成日結的清點金額與時間;沒有日結 = 從 0 起算。 */
export interface VaultBaseline {
  amount: number;
  /** 起算時間(只加總這之後的流水);null = 從頭算。 */
  since: Date | null;
}

/**
 * 日結(P27)登記的起算點來源;回 null = 這家分店還沒有日結。`before` 給了 = 那個時點以前的起算點
 * (關帳快照的月底小金庫:只看那之前送出的已完成日結)。
 */
export type VaultBaselineProvider = (
  tenantId: Types.ObjectId | null,
  orgId: Types.ObjectId,
  before?: Date,
) => Promise<VaultBaseline | null>;

let baselineProvider: VaultBaselineProvider | null = null;

/** 日結功能登記起算點來源(一個;重複 → 拋錯)。回傳撤銷登記的函式。 */
export function registerVaultBaselineProvider(
  provider: VaultBaselineProvider,
): () => void {
  if (baselineProvider !== null) {
    throw new Error("小金庫起算點來源已登記過");
  }
  baselineProvider = provider;
  return () => {
    baselineProvider = null;
  };
}

/** 沒有日結(或日結功能還沒上線)時的起算點。 */
const ZERO_BASELINE: VaultBaseline = { amount: 0, since: null };

/**
 * **現金流水寫入的唯一入口**(專案規格 10.2;正本 `docs/modules/project/accounts.md`「現金流水」)。
 * 店面的出庫 / 投庫 / 存銀行、調貨的現金收付、退貨退款、現金更正都經這裡寫;流水只新增,
 * 記錯用 `reverseCashMovement` 寫一筆反向。應有現金只由流水加總(第 17 章共通原則)。
 *
 * - **必須在交易內**(比照 `BaseRepository.createMany`):`session` 給 `withTransaction` 的 session,
 *   或缺席(`undefined`)= 用進行中的交易(不收 `null`,同 `createMany`);不在交易內 → 拋 `CashLedgerOutsideTransactionError`。
 *   流水與同一個動作的其他寫入(稽核、單據狀態)一起成功、一起回復
 * - 小金庫應有 = `vaultBaseline` 的清點金額 + 之後流水對小金庫的影響
 * - 抽屜應有由店面(P21)以 `sumShiftMovements(shiftId)` 加上班次的期初與售出計算
 */
@Injectable()
export class CashLedgerService {
  constructor(
    private readonly movements: LotteryCashMovementsRepository,
    private readonly settlementMarks: SettlementMarks,
  ) {}

  async recordCashMovement(
    session: ClientSession | undefined,
    input: CashMovementInput,
  ): Promise<CashMovementRecord> {
    const active = activeSessionOf(session);
    checkMovement(input);
    const row = await this.movements.create(
      input.operator,
      {
        orgId: input.orgId,
        occurredAt: input.occurredAt ?? new Date(),
        type: input.type,
        from: input.from,
        to: input.to,
        reason: input.reason ?? null,
        cashPointId: input.cashPointId ?? null,
        shiftId: input.shiftId ?? null,
        attributedShiftId: input.attributedShiftId ?? null,
        postCloseOf: input.postCloseOf ?? null,
        amount: input.amount,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        refRevision: input.refRevision ?? null,
        settlementSide: input.settlementSide ?? null,
        payee: input.payee ?? null,
        note: input.note ?? null,
        reversalOf: null,
        bankTransactionId: input.bankTransactionId ?? null,
      },
      { session: active },
    );
    await this.touchSettlement(row, active);
    return row;
  }

  /** 掛在單據某一邊的收付(含沖正):單據的結清標記改回待確認(待結清只掃還沒結清的)。 */
  private async touchSettlement(
    row: CashMovementRecord,
    session: ClientSession,
  ): Promise<void> {
    if (row.refId !== null && row.settlementSide !== null) {
      await this.settlementMarks.touch(row.tenantId, row.refId, session);
    }
  }

  /**
   * 沖正一筆流水:寫一筆兩端對調、同金額、同類型的流水(`reversalOf` 指向原流水),原流水不改。
   * 已被沖正過、或本身就是沖正 → `VALIDATION_FAILED`(`reason = ALREADY_REVERSED`);
   * 兩個人同時沖正同一筆,由唯一索引擋下後到的那一個。
   */
  async reverseCashMovement(
    session: ClientSession | undefined,
    id: Types.ObjectId | string,
    by: { operator: OperatorContext; note?: string | null },
  ): Promise<CashMovementRecord> {
    const active = activeSessionOf(session);
    const original = await this.movements.findById(by.operator, id, {
      session: active,
    });
    if (!original) {
      throw notFoundError(`cash movement not found: ${String(id)}`);
    }
    if (original.reversalOf !== null) {
      throw alreadyReversed();
    }
    const reversed = await this.movements.findOne(
      by.operator,
      { reversalOf: original._id },
      { session: active },
    );
    if (reversed) {
      throw alreadyReversed();
    }
    let reversal: CashMovementRecord;
    try {
      reversal = await this.movements.create(
        by.operator,
        {
          orgId: original.orgId,
          occurredAt: new Date(),
          type: original.type,
          from: original.to,
          to: original.from,
          reason: original.reason,
          cashPointId: original.cashPointId,
          shiftId: original.shiftId,
          attributedShiftId: original.attributedShiftId,
          postCloseOf: original.postCloseOf ?? null,
          amount: original.amount,
          refType: original.refType,
          refId: original.refId,
          refRevision: original.refRevision,
          settlementSide: original.settlementSide,
          payee: original.payee,
          note: by.note ?? null,
          reversalOf: original._id,
          bankTransactionId: original.bankTransactionId,
        },
        { session: active },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw alreadyReversed();
      }
      throw error;
    }
    await this.touchSettlement(reversal, active);
    return reversal;
  }

  /** 小金庫的起算點(日結登記前一律從 0 起算);`before` 給了 = 那個時點以前的起算點。 */
  async vaultBaseline(
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    before?: Date,
  ): Promise<VaultBaseline> {
    return (
      (await baselineProvider?.(tenantId, orgId, before)) ?? {
        ...ZERO_BASELINE,
      }
    );
  }

  /**
   * 小金庫目前的應有金額 = 起算點 + 之後流水的加總(只從流水算,沒有可改寫的欄位)。
   * `before` 給了 = 那個時點(不含)的應有(關帳快照的月底小金庫):起算點與流水都只看那之前的。
   */
  async vaultExpected(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    before?: Date,
  ): Promise<{ amount: number; baseline: VaultBaseline }> {
    const baseline = await this.vaultBaseline(tenantId, orgId, before);
    const occurredAt = {
      ...(baseline.since === null ? {} : { $gt: baseline.since }),
      ...(before === undefined ? {} : { $lt: before }),
    };
    const sum = await this.sumPlace(operator, "vault", {
      orgId,
      ...(Object.keys(occurredAt).length === 0 ? {} : { occurredAt }),
    });
    return { amount: baseline.amount + sum, baseline };
  }

  /**
   * 一個班次的抽屜流水淨額(流入抽屜 − 流出抽屜);抽屜應有由店面加上期初與售出。
   * 不含事後更正(`postCloseOf`,規格 6.12:結帳時的應有不變)。
   */
  sumShiftMovements(
    operator: OperatorContext,
    shiftId: Types.ObjectId,
  ): Promise<number> {
    return this.sumPlace(operator, "drawer", { shiftId, postCloseOf: null });
  }

  /**
   * 一個班次現金流水的**事後更正淨額**(規格 6.12;退貨退款 −、現金更正 ±):那一班的應有(含事後更正)=
   * 結帳時的應有 + 各來源的事後更正淨額。交班結帳、報表由那些功能加總。
   */
  postCloseNet(
    operator: OperatorContext,
    shiftId: Types.ObjectId,
  ): Promise<number> {
    return this.sumPlace(operator, "drawer", { postCloseOf: shiftId });
  }

  private async sumPlace(
    operator: OperatorContext,
    place: CashPlace,
    match: Record<string, unknown>,
  ): Promise<number> {
    const rows = await this.movements.aggregate(operator, [
      { $match: { ...match, $or: [{ from: place }, { to: place }] } },
      {
        $group: {
          _id: null,
          into: {
            $sum: { $cond: [{ $eq: ["$to", place] }, "$amount", 0] },
          },
          out: {
            $sum: { $cond: [{ $eq: ["$from", place] }, "$amount", 0] },
          },
        },
      },
    ]);
    const row = rows[0] as { into?: number; out?: number } | undefined;
    return (row?.into ?? 0) - (row?.out ?? 0);
  }
}

function alreadyReversed() {
  return validationError(
    "cash movement already reversed",
    ["id"],
    ACCOUNTS_REASONS.alreadyReversed,
  );
}

/** 金額正整數、從 → 到合乎類型、抽屜要有收銀點與班次、出庫要有原因。 */
function checkMovement(input: CashMovementInput): void {
  const errors = new FieldErrors();
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    errors.add("amount");
  }
  if (!isCashRouteAllowed(input.type, input.from, input.to)) {
    errors.add("from");
    errors.add("to");
  }
  const touchesDrawer = input.from === "drawer" || input.to === "drawer";
  if (touchesDrawer && (input.cashPointId == null || input.shiftId == null)) {
    errors.add("shiftId");
  }
  if (input.type === "withdraw" && input.reason == null) {
    errors.add("reason");
  }
  errors.throwIfAny("cash movement input is invalid");
}

/** 現金流水寫在交易外(程式錯誤:流水要與同一個動作的其他寫入一起回復)。 */
export class CashLedgerOutsideTransactionError extends Error {
  constructor() {
    super("現金流水必須在交易內寫入(TransactionService.withTransaction)");
    this.name = "CashLedgerOutsideTransactionError";
  }
}

/** 給的 session,或進行中交易的 session;都不在交易內 → 拋錯。 */
function activeSessionOf(session: ClientSession | undefined): ClientSession {
  const active = session ?? currentSession();
  if (active?.inTransaction() !== true) {
    throw new CashLedgerOutsideTransactionError();
  }
  return active;
}
