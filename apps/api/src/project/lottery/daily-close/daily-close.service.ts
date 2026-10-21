import { Inject, Injectable } from "@nestjs/common";
import type { ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_REASONS,
  CHECKOUT_STATUS,
  CHECKOUT_TYPE,
  DAILY_CLOSE_REASONS,
  type DailyCloseDraft,
  STORE_PERMISSIONS,
  bankDepositProblemOf,
  checkoutDraftTypeOf,
  countedTotalOf,
  isDiffReasonRequired,
  parseDailyCloseDraft,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import type { FormGuardResult } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { LotteryBankAccountsRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import type { LotteryCheckout } from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { BankTransactionsService } from "../accounts/bank-transactions.service";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { conflictError, validationError } from "../checkout/checkout-error";
import { CheckoutService } from "../checkout/checkout.service";
import { SettlementService } from "../settlement/settlement.service";
import type { StocktakeService } from "../stocktake/stocktake.service";
import { STOCKTAKE_SERVICE } from "../stocktake/stocktake.token";
import { parseId } from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { StoreSalesSupport } from "../store/store-sales-support";
import { StoreVaultGuard } from "../store/store-vault-guard";
import { type CheckoutRecord, DailyCloseLedger } from "./daily-close-ledger";

const block = (code: string, message: string): FormGuardResult => ({
  code,
  message,
});

/** 結帳確認申請的值是不是日結(看類型欄位,再看結帳內容)。 */
export function isDailyValues(values: StoredValues): boolean {
  return (
    values[CHECKOUT_FIELD_KEYS.type] === CHECKOUT_TYPE.daily ||
    checkoutDraftTypeOf(values[CHECKOUT_FIELD_KEYS.draft]) ===
      CHECKOUT_TYPE.daily
  );
}

/** 日結的結帳內容;讀不懂 = null。 */
export function dailyDraftOfValues(
  values: StoredValues,
): DailyCloseDraft | null {
  const parsed = parseDailyCloseDraft(values[CHECKOUT_FIELD_KEYS.draft]);
  return parsed.ok ? parsed.draft : null;
}

/** 日結的範圍是全店。 */
const wholeStore = (draft: DailyCloseDraft) => ({
  orgId: draft.orgId,
  cashPointId: null,
});

/**
 * 日結(專案規格 6.10、8.7、6.0;正本 `docs/modules/project/store.md`「日結與存銀行」)的寫入與守門。
 * 結帳確認申請的掛接點(`checkout/checkout-lifecycle.ts`)依類型分派:日結 → 這裡,交班 → `CheckoutService`。
 *
 * - `checkSubmit`(`beforeSubmit`,只讀):有 `store.checkout`;這家店所有收銀點的班都已送出交班結帳(第一次送出);
 *   沒有其他審核中 / 已退回的日結;涵蓋計算的交班結帳全部已核准;全店盤點方式合法;小金庫差額不為 0 要原因;
 *   存入銀行(金額 ≤ 小金庫實點、> 0 要可用的帳戶)
 * - `submitFromSubmission`(`submitted`):同一個交易鎖住小金庫、**再查一次**涵蓋的交班全部核准、算小金庫應有並快照、
 *   建立(或退回後改寫)結帳單(類型 = 日結)、建立全店盤點單(現在盤點)。涵蓋計算期間在**第一次送出**時定下
 * - `apply`(`completed`):套用全店盤點;存入銀行 > 0 → 寫銀行「存入」+ 現金流水「存銀行」(同一種紀錄);
 *   結帳單 → 已確認(小金庫從清點金額重新起算,`DailyCloseRegistrations` 的起算點)
 * - 退回 / 撤回沿用 `CheckoutService.markReturned`;駁回、作廢一律擋下(同交班)
 */
@Injectable()
export class DailyCloseService {
  constructor(
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly accounts: LotteryBankAccountsRepository,
    private readonly orgs: OrgsRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly dailyLedger: DailyCloseLedger,
    private readonly checkout: CheckoutService,
    private readonly settlement: SettlementService,
    private readonly bankTransactions: BankTransactionsService,
    private readonly cashLedger: CashLedgerService,
    private readonly vault: StoreVaultGuard,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
    @Inject(STOCKTAKE_SERVICE)
    private readonly stocktakeService: StocktakeService,
  ) {}

  /** 結帳確認申請的值是不是日結(掛接點的守門依它分派)。 */
  isDailyValues(values: StoredValues): boolean {
    return isDailyValues(values);
  }

  // ---- 守門 ----

  async checkSubmit(
    operator: OperatorContext,
    submissionId: Types.ObjectId,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const draft = dailyDraftOfValues(values);
    if (draft === null) {
      return block(CHECKOUT_REASONS.invalid, "daily close draft is invalid");
    }
    return this.checkDraft(operator, submissionId, draft);
  }

  async checkDraft(
    operator: OperatorContext,
    submissionId: Types.ObjectId | null,
    draft: DailyCloseDraft,
  ): Promise<FormGuardResult> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.checkout)) {
      return block(CHECKOUT_REASONS.forbidden, "missing store.checkout");
    }
    let store;
    try {
      store = await this.support.mustStore(operator, draft.orgId);
    } catch {
      return block(CHECKOUT_REASONS.invalid, "store is not visible");
    }
    const own =
      submissionId === null
        ? null
        : await this.checkouts.findOne(operator, { submissionId });
    const period = await this.periodCheck(operator, store.orgId, own);
    if (period !== null) {
      return period;
    }
    const stocktake = await this.checkout.checkStocktakeChoice(
      operator,
      grant,
      wholeStore(draft),
      draft.stocktake,
    );
    if (stocktake !== null) {
      return stocktake;
    }
    const counted = countedTotalOf(draft.denominations);
    const vault = await this.dailyLedger.vaultCashOf(
      operator,
      store.tenantId,
      store.orgId,
    );
    if (isDiffReasonRequired(counted - vault.expected)) {
      const reason = await this.checkout.reasonOf(
        operator,
        LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason,
        { reasonKey: draft.diffReasonKey, reasonNote: draft.diffReasonNote },
      );
      if (reason === null) {
        return block(
          CHECKOUT_REASONS.reasonRequired,
          "vault difference reason is required",
        );
      }
    }
    return this.checkDeposit(store.tenantId, store.orgId, draft, counted);
  }

  /**
   * 涵蓋計算期間的守門:沒有其他審核中 / 已退回的日結;第一次送出時這家店不能有開著的班;
   * 涵蓋計算的交班結帳全部已核准(退回後再送出 = 原本那段期間)。
   */
  private async periodCheck(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    own: CheckoutRecord | null,
  ): Promise<FormGuardResult> {
    const pending = await this.dailyLedger.pendingDaily(
      reader,
      orgId,
      own?.submissionId ?? null,
    );
    if (pending !== null) {
      return block(
        DAILY_CLOSE_REASONS.pendingExists,
        "this store already has a daily close under review",
      );
    }
    if (own === null) {
      const open = await this.dailyLedger.openShifts(reader, orgId);
      if (open.length > 0) {
        return block(
          DAILY_CLOSE_REASONS.shiftsOpen,
          "some shifts have not checked out yet",
        );
      }
    }
    const shifts = await this.coveredOf(reader, orgId, own, null);
    return (await this.allApproved(reader, shifts.shiftIds))
      ? null
      : block(
          DAILY_CLOSE_REASONS.unapproved,
          "covered shift checkouts are not all approved",
        );
  }

  /** 涵蓋計算期間與那段期間的班(第一次送出:上一張日結 至 `to`;退回後再送出:原本那段)。 */
  private async coveredOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    own: CheckoutRecord | null,
    to: Date | null,
    session?: ClientSession,
  ): Promise<{
    from: Date | null;
    to: Date | null;
    shiftIds: Types.ObjectId[];
  }> {
    if (own !== null) {
      return {
        from: own.coveredFrom,
        to: own.coveredTo,
        shiftIds: own.coveredShiftIds,
      };
    }
    const last = await this.dailyLedger.lastDaily(reader, orgId, null, session);
    const from = last?.coveredTo ?? null;
    const shifts = await this.dailyLedger.coveredShifts(
      reader,
      orgId,
      from,
      to,
      session,
    );
    return { from, to, shiftIds: shifts.map((shift) => shift._id) };
  }

  /** 涵蓋計算的交班結帳全部已核准(已確認)。 */
  private async allApproved(
    reader: OperatorContext,
    shiftIds: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<boolean> {
    const checkouts = await this.dailyLedger.shiftCheckoutsOf(
      reader,
      shiftIds,
      session,
    );
    return shiftIds.every(
      (id) => checkouts.get(String(id))?.status === CHECKOUT_STATUS.confirmed,
    );
  }

  /** 存入銀行:非負整數、不超過小金庫實點、> 0 要選這家店可用的帳戶(使用中、使用組織包含這家店)。 */
  private async checkDeposit(
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    draft: DailyCloseDraft,
    counted: number,
  ): Promise<FormGuardResult> {
    const problem = bankDepositProblemOf({
      ...draft.bankDeposit,
      available: counted,
    });
    if (problem === "account_required") {
      return block(DAILY_CLOSE_REASONS.accountNotUsable, "account required");
    }
    if (problem !== null) {
      return block(DAILY_CLOSE_REASONS.depositInvalid, problem);
    }
    if (draft.bankDeposit.amount === 0) {
      return null;
    }
    const accountId = parseId(draft.bankDeposit.accountId);
    const usable =
      accountId !== null &&
      (await this.settlement.isAccountUsable(tenantId, accountId, orgId));
    return usable
      ? null
      : block(DAILY_CLOSE_REASONS.accountNotUsable, "account is not usable");
  }

  // ---- 送出 ----

  /** 這張申請是不是日結(掛接點的事後動作沒有值,讀申請)。 */
  async isDaily(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<boolean> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findById(reader, submissionId, {
      session,
    });
    return submission !== null && isDailyValues(submission.values);
  }

  /**
   * 送出(`submitted`):同一個交易鎖住小金庫、再查一次涵蓋的交班全部核准、算小金庫應有並快照、
   * 建立 / 改寫結帳單、建立全店盤點單。系統身分以租戶邊界讀寫。
   */
  async submitFromSubmission(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findById(reader, submissionId, {
      session,
    });
    const draft =
      submission === null ? null : dailyDraftOfValues(submission.values);
    const orgId = parseId(draft?.orgId ?? null);
    if (submission === null || draft === null || orgId === null) {
      throw validationError(
        "daily close draft is invalid",
        ["draft"],
        CHECKOUT_REASONS.invalid,
      );
    }
    await this.vault.serialize(reader, orgId, session);
    const existing = await this.checkouts.findOne(
      reader,
      { submissionId },
      { session },
    );
    if (
      (await this.dailyLedger.pendingDaily(
        reader,
        orgId,
        submissionId,
        session,
      )) !== null
    ) {
      throw conflictError(
        "this store already has a daily close under review",
        DAILY_CLOSE_REASONS.pendingExists,
      );
    }
    const now = this.clock.now();
    const open =
      existing === null
        ? await this.dailyLedger.openShifts(reader, orgId, session)
        : [];
    if (open.length > 0) {
      throw conflictError(
        "some shifts have not checked out yet",
        DAILY_CLOSE_REASONS.shiftsOpen,
      );
    }
    // 後端送出時再查一次:涵蓋計算的交班結帳全部已核准(規格 6.10)
    const covered = await this.coveredOf(reader, orgId, existing, now, session);
    if (!(await this.allApproved(reader, covered.shiftIds, session))) {
      throw conflictError(
        "covered shift checkouts are not all approved",
        DAILY_CLOSE_REASONS.unapproved,
      );
    }
    const vault = await this.dailyLedger.vaultCashOf(
      reader,
      tenantId,
      orgId,
      session,
    );
    const counted = countedTotalOf(draft.denominations);
    const difference = counted - vault.expected;
    const diffReason = isDiffReasonRequired(difference)
      ? await this.checkout.reasonOf(
          reader,
          LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason,
          { reasonKey: draft.diffReasonKey, reasonNote: draft.diffReasonNote },
        )
      : null;
    if (isDiffReasonRequired(difference) && diffReason === null) {
      throw validationError(
        "vault difference reason is required",
        ["diffReasonKey"],
        CHECKOUT_REASONS.reasonRequired,
      );
    }
    if ((await this.checkDeposit(tenantId, orgId, draft, counted)) !== null) {
      throw validationError(
        "bank deposit is invalid",
        ["bankDeposit"],
        DAILY_CLOSE_REASONS.depositInvalid,
      );
    }
    const stocktake = await this.checkout.writeStocktake(
      session,
      reader,
      tenantId,
      submission,
      wholeStore(draft),
      draft.stocktake,
      "daily",
    );
    const content: Omit<
      LotteryCheckout,
      "moduleKey" | "tenantId" | "version" | "orgId"
    > = {
      type: CHECKOUT_TYPE.daily,
      status: CHECKOUT_STATUS.pending,
      cashPointId: null,
      shiftId: null,
      stocktakeMode: draft.stocktake.mode,
      stocktakeId: stocktake.stocktakeId,
      skipReasonKey: stocktake.skip?.reasonKey ?? null,
      skipReason: stocktake.skip?.reasonLabel ?? null,
      skipReasonNote: stocktake.skip?.reasonNote ?? null,
      expectedItems: vault.items,
      expected: vault.expected,
      denominations: draft.denominations.filter((row) => row.count > 0),
      counted,
      difference,
      diffReasonKey: diffReason?.reasonKey ?? null,
      diffReason: diffReason?.reasonLabel ?? null,
      diffReasonNote: diffReason?.reasonNote ?? null,
      pendingImpacts: [],
      leftForNext: 0,
      successorId: null,
      submittedBy: submission.createdBy ?? null,
      submittedAt: now,
      confirmedAt: null,
      confirmedBy: null,
      // 涵蓋計算期間在第一次送出時定下(退回後再送出不變)
      coveredFrom: covered.from,
      coveredTo: covered.to ?? now,
      coveredShiftIds: covered.shiftIds,
      bankDepositAmount: draft.bankDeposit.amount,
      bankAccountId:
        draft.bankDeposit.amount > 0
          ? parseId(draft.bankDeposit.accountId)
          : null,
      bankTransactionId: null,
      bankMovementId: null,
      submissionId,
    };
    await (existing === null
      ? this.checkouts.create(
          reader,
          { orgId, ...content, version: 0 },
          { session },
        )
      : this.checkouts.findOneAndUpdate(
          reader,
          { _id: existing._id, version: existing.version },
          { $set: content, $inc: { version: 1 } },
          { session },
        ));
    await this.support.publish({ orgId, tenantId });
  }

  // ---- 完成 ----

  /**
   * 核准完成:套用全店盤點;存入銀行 > 0 → 同一個交易寫銀行「存入」(歸屬分店 = 這家店)與現金流水「存銀行」
   * (小金庫 → 銀行,連到那筆存入);結帳單 → 已確認(小金庫從清點金額重新起算)。
   */
  async apply(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const record = await this.checkouts.findOne(
      reader,
      {
        submissionId,
        type: CHECKOUT_TYPE.daily,
        status: CHECKOUT_STATUS.pending,
      },
      { session },
    );
    if (record === null) {
      return;
    }
    if (record.stocktakeMode === "new") {
      await this.stocktakeService.apply(session, tenantId, submissionId);
    }
    await this.vault.serialize(reader, record.orgId, session);
    const deposit = await this.writeDeposit(session, reader, record);
    await this.checkouts.findOneAndUpdate(
      reader,
      { _id: record._id, version: record.version },
      {
        $set: {
          status: CHECKOUT_STATUS.confirmed,
          confirmedAt: this.clock.now(),
          confirmedBy: await this.checkout.approverOf(
            tenantId,
            submissionId,
            session,
          ),
          bankTransactionId: deposit?.transactionId ?? null,
          bankMovementId: deposit?.movementId ?? null,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    await this.support.publish({ orgId: record.orgId, tenantId });
  }

  private async writeDeposit(
    session: ClientSession,
    reader: OperatorContext,
    record: CheckoutRecord,
  ): Promise<{
    transactionId: Types.ObjectId;
    movementId: Types.ObjectId;
  } | null> {
    if (record.bankDepositAmount <= 0 || record.bankAccountId === null) {
      return null;
    }
    const account = await this.accounts.findById(reader, record.bankAccountId, {
      session,
    });
    if (account === null) {
      throw validationError(
        "bank account not found",
        ["bankDeposit"],
        DAILY_CLOSE_REASONS.accountNotUsable,
      );
    }
    const now = this.clock.now();
    const writer = { ...reader, currentOrgId: record.orgId };
    const transaction = await this.bankTransactions.write(
      writer,
      {
        account,
        type: "deposit",
        direction: "in",
        amount: record.bankDepositAmount,
        occurredAt: now,
        branchOrgId: record.orgId,
        refType: "store",
        refId: record.submissionId,
        summary: "日結存入銀行",
      },
      // 已送出單據的系統寫入:送出時已驗過帳戶,之後停用不影響這張日結(也不再檢查使用組織)
      { session, allowInactiveAccount: true },
    );
    const movement = await this.cashLedger.recordCashMovement(session, {
      operator: writer,
      orgId: record.orgId,
      type: "bank_deposit",
      from: "vault",
      to: "bank",
      amount: record.bankDepositAmount,
      occurredAt: now,
      refType: "store",
      refId: record.submissionId,
      bankTransactionId: transaction._id,
    });
    return { transactionId: transaction._id, movementId: movement._id };
  }
}
