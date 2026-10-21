import { Injectable } from "@nestjs/common";

import type { WithdrawReason } from "@repo/domain/project/lottery-accounts";
import {
  LOTTERY_FIELD_CATEGORY_KEYS,
  WITHDRAW_OPENING_FLOAT,
} from "@repo/domain/project/lottery-fields";
import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";

import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import { FieldOptionsService } from "../../../fields/field-options.service";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { expectedDrawerCash } from "./drawer-cash";
import type {
  DepositLotteryShiftCashInput,
  WithdrawLotteryShiftCashInput,
} from "./dto/lottery-store.input";
import type { LotteryStoreShiftModel } from "./models/lottery-store.model";
import { type ShiftRecord, StoreShiftViews, parseId } from "./shift-views";
import { publishStoreBoard } from "./store-board-signal";
import { STORE_REASONS, notFoundError, validationError } from "./store-error";
import { StoreVaultGuard } from "./store-vault-guard";

/** 欄位管理「出庫原因」的「補零錢」(種子選項;程式要認得的代碼)。 */
const WITHDRAW_CHANGE_REFILL = "change-refill";

/**
 * 出庫原因(欄位管理選項)→ 現金流水的原因代碼(`WITHDRAW_REASONS` 三種):開班零用金、補零錢,
 * 其他(含租戶自己加的選項)一律記「其他」,選項名稱與說明寫進流水的備註。
 */
export function withdrawReasonOf(optionValue: string): WithdrawReason {
  if (optionValue === WITHDRAW_OPENING_FLOAT) {
    return "opening_float";
  }
  if (optionValue === WITHDRAW_CHANGE_REFILL) {
    return "change";
  }
  return "other";
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

/**
 * 投庫 / 出庫(專案規格 6.7;正本 `docs/modules/project/store.md`「投庫、出庫」):寫現金流水
 * (經 `CashLedgerService`,同一個交易),不用審核、做完就生效。班要開著;投庫不能超過抽屜目前的應有、
 * 出庫不能超過小金庫目前的應有(`StoreVaultGuard`,使用者 10/21 定案)。
 * 同一班兩個動作同時送出:交易內先把班的 `drawerVersion` +1,讓兩個交易互相衝突、重試時依序檢查。
 * 「自動列印」由列印的票加在這裡的事後動作。
 */
@Injectable()
export class StoreCashService {
  constructor(
    private readonly shifts: LotteryShiftsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly ledger: CashLedgerService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly transactions: TransactionService,
    private readonly realtime: RealtimePublisher,
    private readonly views: StoreShiftViews,
    private readonly vault: StoreVaultGuard,
  ) {}

  async deposit(
    operator: OperatorContext,
    input: DepositLotteryShiftCashInput,
  ): Promise<LotteryStoreShiftModel> {
    assertAmount(input.amount);
    const shift = await this.mustShift(operator, input.shiftId);
    const updated = await this.transactions.withTransaction(async () => {
      const locked = await this.lockOpenShift(operator, shift);
      const expected = await expectedDrawerCash(operator, locked);
      if (input.amount > expected) {
        throw validationError(
          "deposit exceeds the drawer's expected cash",
          ["amount"],
          STORE_REASONS.amountExceedsDrawer,
        );
      }
      await this.ledger.recordCashMovement(undefined, {
        operator,
        orgId: locked.orgId,
        type: "deposit",
        from: "drawer",
        to: "vault",
        amount: input.amount,
        cashPointId: locked.cashPointId,
        shiftId: locked._id,
        note: trimmed(input.note),
      });
      await publishStoreBoard(this.realtime, locked.tenantId, locked.orgId);
      return locked;
    });
    return this.modelOf(operator, updated);
  }

  async withdraw(
    operator: OperatorContext,
    input: WithdrawLotteryShiftCashInput,
  ): Promise<LotteryStoreShiftModel> {
    assertAmount(input.amount);
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.withdrawReason,
      {
        reasonKey: input.reasonKey ?? null,
        reasonNote: input.reasonNote ?? null,
      },
      LOTTERY_FIELD_CATEGORIES,
    );
    const code = withdrawReasonOf(reason.reasonKey);
    const note =
      code === "other"
        ? [
            reason.reasonKey === REASON_OTHER_VALUE ? null : reason.reasonLabel,
            reason.reasonNote,
            trimmed(input.note),
          ]
            .filter((part) => part !== null)
            .join(" · ") || null
        : trimmed(input.note);
    const shift = await this.mustShift(operator, input.shiftId);
    await this.vault.prepare(operator, shift.orgId);
    const updated = await this.transactions.withTransaction(async () => {
      const locked = await this.lockOpenShift(operator, shift);
      // 不能超過小金庫應有(同一家店同時兩筆出庫在小金庫守門文件上序列化)
      await this.vault.assertCovers(
        operator,
        locked.tenantId,
        locked.orgId,
        input.amount,
        "amount",
      );
      await this.ledger.recordCashMovement(undefined, {
        operator,
        orgId: locked.orgId,
        type: "withdraw",
        from: "vault",
        to: "drawer",
        amount: input.amount,
        reason: code,
        cashPointId: locked.cashPointId,
        shiftId: locked._id,
        note,
      });
      await publishStoreBoard(this.realtime, locked.tenantId, locked.orgId);
      return locked;
    });
    return this.modelOf(operator, updated);
  }

  // ---- 內部 ----

  /** 班要開著;抽屜版本 +1(同一班同時的動作在這裡互相衝突)。 */
  private async lockOpenShift(
    operator: OperatorContext,
    shift: ShiftRecord,
  ): Promise<ShiftRecord> {
    const locked = await this.shifts.findOneAndUpdate(
      operator,
      { _id: shift._id, closedAt: null },
      { $inc: { drawerVersion: 1 } },
    );
    if (locked === null) {
      throw validationError(
        "this shift has been checked out",
        ["shiftId"],
        STORE_REASONS.shiftClosed,
      );
    }
    return locked;
  }

  private async mustShift(
    operator: OperatorContext,
    idText: string,
  ): Promise<ShiftRecord> {
    const id = parseId(idText);
    const shift = id === null ? null : await this.shifts.findById(operator, id);
    if (shift === null) {
      throw notFoundError(`shift not found: ${idText}`);
    }
    return shift;
  }

  private async modelOf(
    operator: OperatorContext,
    shift: ShiftRecord,
  ): Promise<LotteryStoreShiftModel> {
    const point = await this.cashPoints.findById(operator, shift.cashPointId);
    const [model] = await this.views.toModels(
      operator,
      [shift],
      new Map([[String(shift.cashPointId), point?.name ?? ""]]),
    );
    if (model === undefined) {
      throw notFoundError("shift not found");
    }
    return model;
  }
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw validationError("amount must be a positive integer", ["amount"]);
  }
}
