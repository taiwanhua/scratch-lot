import { Inject, Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_REASONS,
  CHECKOUT_STATUS,
  type CheckoutDraft,
  STOCKTAKE_STATUS,
  STORE_PERMISSIONS,
  checkoutHandoverProblemOf,
  countedTotalOf,
  expectedCashTotalOf,
  isDiffReasonRequired,
  isStocktakeReusable,
  parseCheckoutDraft,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { RelationService } from "../../../database/relation.service";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import { FieldOptionsService } from "../../../fields/field-options.service";
import type { FormGuardResult } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import type { LotteryCheckout } from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import type { StocktakeService } from "../stocktake/stocktake.service";
import { STOCKTAKE_SERVICE } from "../stocktake/stocktake.token";
import { type ShiftRecord, parseId } from "../store/shift-views";
import {
  StoreAccess,
  type StoreGrant,
  isStoreManager,
} from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { StoreFormsQueryService } from "../store/store-forms-query.service";
import { StoreSalesSupport } from "../store/store-sales-support";
import { conflictError, validationError } from "./checkout-error";
import { ExpectedCashItems } from "./expected-cash";

const block = (code: string, message: string): FormGuardResult => ({
  code,
  message,
});

/** 結帳內容(表單的 `draft` 欄位)→ 讀得懂的結帳內容;讀不懂 = null。 */
export function draftOfValues(values: StoredValues): CheckoutDraft | null {
  const parsed = parseCheckoutDraft(values[CHECKOUT_FIELD_KEYS.draft]);
  return parsed.ok ? parsed.draft : null;
}

/**
 * 交班結帳(專案規格 6.9、8.7、6.0;正本 `docs/modules/project/store.md`「交班結帳」)的寫入與守門:
 *
 * - `checkDraft`(`beforeSubmit`,只讀):有 `store.checkout`、是負責人或店長;班開著(退回後修改 = 自己那張);
 *   這一班沒有其他審核中的結帳;盤點方式合法(沿用 30 分鐘內 / 現在盤點照盤點的守門 / 跳過要 `store.skip-stocktake` + 原因);
 *   差額不為 0 要原因;交接(留給下一班 > 0 要接班人、沒有接班人必須是 0、接班人是這家店的人)
 * - `submitFromSubmission`(`submitted`):同一個交易鎖住抽屜、算應有現金各項並快照、建立(或退回後改寫)結帳單、
 *   建立盤點單(現在盤點)、這一班結束(`closedAt`、`checkoutId`)、下一班已先開時更新它的期初
 * - `markReturned`(`returned` / `withdrawn`):結帳單 → 已退回(自己的盤點單也退回)
 * - `apply`(`completed`):套用自己的盤點單、結帳單 → 已確認
 * - **駁回前、作廢前一律擋下**(只能退回)
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly orgs: OrgsRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly workflowTasks: WorkflowTasksRepository,
    private readonly relations: RelationService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
    private readonly storeForms: StoreFormsQueryService,
    private readonly expectedCash: ExpectedCashItems,
    @Inject(STOCKTAKE_SERVICE)
    private readonly stocktakeService: StocktakeService,
  ) {}

  // ---- 守門 ----

  /** 送出前守門(`beforeSubmit`)。 */
  async checkSubmit(
    operator: OperatorContext,
    submissionId: Types.ObjectId,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const draft = draftOfValues(values);
    if (draft === null) {
      return block(CHECKOUT_REASONS.invalid, "checkout draft is invalid");
    }
    return this.checkDraft(operator, submissionId, draft);
  }

  async checkDraft(
    operator: OperatorContext,
    submissionId: Types.ObjectId | null,
    draft: CheckoutDraft,
  ): Promise<FormGuardResult> {
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.checkout)) {
      return block(CHECKOUT_REASONS.forbidden, "missing store.checkout");
    }
    const shift = await this.shiftOfDraft(operator, draft);
    if (shift === null) {
      return block(CHECKOUT_REASONS.invalid, "shift does not match the draft");
    }
    if (!this.canCheckout(operator, grant, shift)) {
      return block(
        CHECKOUT_REASONS.forbidden,
        "only the shift owner or a store manager can check out",
      );
    }
    const shiftState = await this.checkShiftState(
      operator,
      shift,
      submissionId,
    );
    if (shiftState !== null) {
      return shiftState;
    }
    const stocktake = await this.checkStocktakeChoice(operator, grant, draft);
    if (stocktake !== null) {
      return stocktake;
    }
    const counted = countedTotalOf(draft.denominations);
    const expected = expectedCashTotalOf(
      await this.expectedCash.of(operator, shift),
    );
    if (isDiffReasonRequired(counted - expected)) {
      const reason = await this.reasonOf(
        operator,
        LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason,
        { reasonKey: draft.diffReasonKey, reasonNote: draft.diffReasonNote },
      );
      if (reason === null) {
        return block(
          CHECKOUT_REASONS.reasonRequired,
          "difference reason is required",
        );
      }
    }
    return this.checkHandover(shift, draft);
  }

  /** 結帳內容指的那一班(分店、收銀點都要對得上);對不上 = null。 */
  private async shiftOfDraft(
    operator: OperatorContext,
    draft: CheckoutDraft,
  ): Promise<ShiftRecord | null> {
    const shiftId = parseId(draft.shiftId);
    const shift =
      shiftId === null ? null : await this.shifts.findById(operator, shiftId);
    return shift !== null &&
      String(shift.orgId) === draft.orgId &&
      String(shift.cashPointId) === draft.cashPointId
      ? shift
      : null;
  }

  /** 這一班沒有其他審核中的結帳;班開著(退回後再送出 = 自己那張結帳的班)。 */
  private async checkShiftState(
    operator: OperatorContext,
    shift: ShiftRecord,
    submissionId: Types.ObjectId | null,
  ): Promise<FormGuardResult> {
    const pending = await this.checkouts.findOne(operator, {
      shiftId: shift._id,
      status: CHECKOUT_STATUS.pending,
      ...(submissionId === null ? {} : { submissionId: { $ne: submissionId } }),
    });
    if (pending !== null) {
      return block(
        CHECKOUT_REASONS.pendingExists,
        "this shift already has a checkout under review",
      );
    }
    const own = await this.checkouts.findOne(operator, { shiftId: shift._id });
    const isResubmit =
      own !== null &&
      submissionId !== null &&
      own.submissionId.equals(submissionId);
    return shift.closedAt !== null && !isResubmit
      ? block(CHECKOUT_REASONS.shiftClosed, "shift already closed")
      : null;
  }

  /** 交接:留給下一班是非負整數、> 0 要接班人(沒有接班人必須是 0)、接班人是這家店的人。 */
  private async checkHandover(
    shift: ShiftRecord,
    draft: CheckoutDraft,
  ): Promise<FormGuardResult> {
    const handover = checkoutHandoverProblemOf(draft);
    if (handover === "invalid_amount") {
      return block(CHECKOUT_REASONS.invalid, "left for next is invalid");
    }
    if (handover === "must_be_zero") {
      return block(
        CHECKOUT_REASONS.leftMustBeZero,
        "left for next must be 0 without a successor",
      );
    }
    if (draft.successorId === null) {
      return null;
    }
    const successorId = parseId(draft.successorId);
    const members =
      successorId === null
        ? []
        : await this.relations.listUserIdsOfOrg(shift.orgId);
    return successorId !== null && members.some((id) => id.equals(successorId))
      ? null
      : block(
          CHECKOUT_REASONS.successorInvalid,
          "successor is not a member of this store",
        );
  }

  /** 負責人或店長(店長 = 持有 `store.edit`,`isStoreManager`)。 */
  canCheckout(
    operator: OperatorContext,
    grant: StoreGrant,
    shift: Pick<ShiftRecord, "openedBy">,
  ): boolean {
    return (
      (operator.actorId !== null && shift.openedBy.equals(operator.actorId)) ||
      isStoreManager(grant)
    );
  }

  private async checkStocktakeChoice(
    operator: OperatorContext,
    grant: StoreGrant,
    draft: CheckoutDraft,
  ): Promise<FormGuardResult> {
    const choice = draft.stocktake;
    switch (choice.mode) {
      case "skip": {
        if (!grant.has(STORE_PERMISSIONS.skipStocktake)) {
          return block(
            CHECKOUT_REASONS.forbidden,
            "missing store.skip-stocktake",
          );
        }
        const reason = await this.reasonOf(
          operator,
          LOTTERY_FIELD_CATEGORY_KEYS.skipStocktakeReason,
          choice,
        );
        return reason === null
          ? block(
              CHECKOUT_REASONS.reasonRequired,
              "skip stocktake reason is required",
            )
          : null;
      }
      case "reuse": {
        const reusable = await this.reusableStocktake(operator, draft, choice);
        return reusable === null
          ? block(
              CHECKOUT_REASONS.stocktakeNotReusable,
              "stocktake cannot be reused",
            )
          : null;
      }
      case "new": {
        if (
          choice.draft.orgId !== draft.orgId ||
          choice.draft.scopeCashPointId !== draft.cashPointId
        ) {
          return block(
            CHECKOUT_REASONS.invalid,
            "stocktake draft must cover this cash point",
          );
        }
        return this.stocktakeService.checkDraft(operator, choice.draft);
      }
    }
  }

  /** 沿用的盤點:這家店的、範圍是這個收銀點或全店、沒被駁回、開始盤的時間在 30 分鐘內。 */
  private async reusableStocktake(
    reader: OperatorContext,
    draft: Pick<CheckoutDraft, "orgId" | "cashPointId">,
    choice: { submissionId: string },
    session?: ClientSession,
  ) {
    const submissionId = parseId(choice.submissionId);
    if (submissionId === null) {
      return null;
    }
    const record = await this.stocktakes.findOne(
      reader,
      {
        submissionId,
        orgId: new Types.ObjectId(draft.orgId),
        status: { $ne: STOCKTAKE_STATUS.rejected },
      },
      session === undefined ? {} : { session },
    );
    if (
      record === null ||
      (record.scopeCashPointId !== null &&
        String(record.scopeCashPointId) !== draft.cashPointId) ||
      !isStocktakeReusable(record.startedAt, this.clock.now())
    ) {
      return null;
    }
    return record;
  }

  /** 原因檢查(欄位管理;其他要說明);不合 → null。 */
  private async reasonOf(
    reader: OperatorContext,
    categoryKey: string,
    input: { reasonKey: string | null; reasonNote: string | null },
  ) {
    try {
      return await this.fieldOptions.assertReason(
        reader,
        categoryKey,
        input,
        LOTTERY_FIELD_CATEGORIES,
      );
    } catch {
      return null;
    }
  }

  /** 駁回前(`beforeReject`)、作廢前(`beforeVoid`):一律擋下。 */
  beforeReject(): FormGuardResult {
    return block(
      CHECKOUT_REASONS.rejectForbidden,
      "checkout confirmations cannot be rejected; return it instead",
    );
  }

  beforeVoid(): FormGuardResult {
    return block(
      CHECKOUT_REASONS.voidForbidden,
      "checkout confirmations cannot be voided",
    );
  }

  // ---- 送出 ----

  /**
   * 送出(`submitted`):讀申請的結帳內容,在同一個交易鎖住抽屜(`drawerVersion` +1,和售出 / 投庫序列化)、
   * 算應有現金各項並快照、建立 / 改寫結帳單、建立盤點單(現在盤點)、這一班結束、更新已先開的下一班的期初。
   * 系統身分以租戶邊界讀寫(掛接點沒有操作者的範圍)。
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
    const draft = submission === null ? null : draftOfValues(submission.values);
    if (submission === null || draft === null) {
      throw validationError(
        "checkout draft is invalid",
        ["draft"],
        CHECKOUT_REASONS.invalid,
      );
    }
    const shiftId = parseId(draft.shiftId);
    const existing = await this.checkouts.findOne(
      reader,
      { submissionId },
      { session },
    );
    // 第一次送出:鎖住開著的抽屜並結束這一班;退回後再送出:班已結束,只改寫結帳單
    let shift: ShiftRecord | null = null;
    if (shiftId !== null && existing === null) {
      shift = await this.shifts.findOneAndUpdate(
        reader,
        { _id: shiftId, closedAt: null },
        { $inc: { drawerVersion: 1 } },
        { session },
      );
    } else if (shiftId !== null) {
      shift = await this.shifts.findById(reader, shiftId, { session });
    }
    if (shift === null) {
      throw conflictError(
        `shift ${draft.shiftId} is gone or already closed`,
        CHECKOUT_REASONS.shiftClosed,
      );
    }
    const now = this.clock.now();
    const items = await this.expectedCash.of(reader, shift, session);
    const expected = expectedCashTotalOf(items);
    const counted = countedTotalOf(draft.denominations);
    const difference = counted - expected;
    const diffReason = isDiffReasonRequired(difference)
      ? await this.reasonOf(
          reader,
          LOTTERY_FIELD_CATEGORY_KEYS.checkoutDiffReason,
          {
            reasonKey: draft.diffReasonKey,
            reasonNote: draft.diffReasonNote,
          },
        )
      : null;
    if (isDiffReasonRequired(difference) && diffReason === null) {
      throw validationError(
        "difference reason is required",
        ["diffReasonKey"],
        CHECKOUT_REASONS.reasonRequired,
      );
    }
    const pending = await this.storeForms.pendingCashImpacts(reader, shift._id);
    const stocktake = await this.writeStocktake(
      session,
      reader,
      tenantId,
      submission,
      draft,
    );
    // `orgId` 只在建立時寫(BaseRepository 不讓一般更新改它);退回後再送出改寫其餘欄位
    const content: Omit<
      LotteryCheckout,
      "moduleKey" | "tenantId" | "version" | "orgId"
    > = {
      type: "shift",
      status: CHECKOUT_STATUS.pending,
      cashPointId: shift.cashPointId,
      shiftId: shift._id,
      stocktakeMode: draft.stocktake.mode,
      stocktakeId: stocktake.stocktakeId,
      skipReasonKey: stocktake.skip?.reasonKey ?? null,
      skipReason: stocktake.skip?.reasonLabel ?? null,
      skipReasonNote: stocktake.skip?.reasonNote ?? null,
      expectedItems: items,
      expected,
      denominations: draft.denominations.filter((row) => row.count > 0),
      counted,
      difference,
      diffReasonKey: diffReason?.reasonKey ?? null,
      diffReason: diffReason?.reasonLabel ?? null,
      diffReasonNote: diffReason?.reasonNote ?? null,
      pendingImpacts: pending.map((impact) => ({
        submissionId: impact.submissionId,
        formKey: impact.formKey,
        serialNo: impact.serialNo,
        amount: impact.amount,
      })),
      leftForNext: draft.leftForNext,
      successorId: parseId(draft.successorId),
      submittedBy: submission.createdBy ?? null,
      submittedAt: now,
      confirmedAt: null,
      confirmedBy: null,
      submissionId,
    };
    let checkoutId: Types.ObjectId;
    if (existing === null) {
      const created = await this.checkouts.create(
        reader,
        { orgId: shift.orgId, ...content, version: 0 },
        { session },
      );
      checkoutId = created._id;
    } else {
      await this.checkouts.findOneAndUpdate(
        reader,
        { _id: existing._id, version: existing.version },
        { $set: content, $inc: { version: 1 } },
        { session },
      );
      checkoutId = existing._id;
    }
    if (shift.closedAt === null) {
      await this.shifts.findOneAndUpdate(
        reader,
        { _id: shift._id, closedAt: null },
        { $set: { closedAt: now, checkoutId } },
        { session },
      );
    }
    // 下一班已先開班(期初來自這一班「留給下一班」)→ 期初跟著更新(規格 8.7)
    await this.shifts.updateMany(
      reader,
      { previousShiftId: shift._id, openingFloatSource: "handover" },
      { $set: { openingFloat: draft.leftForNext } },
      { session },
    );
    await this.support.publish({ orgId: shift.orgId, tenantId });
  }

  /** 盤點方式 → 盤點單 id(現在盤點:同一個交易建立;沿用:那一筆;跳過:null + 原因)。 */
  private async writeStocktake(
    session: ClientSession,
    reader: OperatorContext,
    tenantId: Types.ObjectId | null,
    submission: { _id: Types.ObjectId; createdBy?: Types.ObjectId | null },
    draft: CheckoutDraft,
  ): Promise<{
    stocktakeId: Types.ObjectId | null;
    skip: {
      reasonKey: string;
      reasonLabel: string;
      reasonNote: string | null;
    } | null;
  }> {
    const choice = draft.stocktake;
    switch (choice.mode) {
      case "skip": {
        const reason = await this.reasonOf(
          reader,
          LOTTERY_FIELD_CATEGORY_KEYS.skipStocktakeReason,
          choice,
        );
        if (reason === null) {
          throw validationError(
            "skip stocktake reason is required",
            ["stocktake"],
            CHECKOUT_REASONS.reasonRequired,
          );
        }
        return { stocktakeId: null, skip: reason };
      }
      case "reuse": {
        const record = await this.reusableStocktake(
          reader,
          draft,
          choice,
          session,
        );
        if (record === null) {
          throw validationError(
            "stocktake cannot be reused",
            ["stocktake"],
            CHECKOUT_REASONS.stocktakeNotReusable,
          );
        }
        return { stocktakeId: record._id, skip: null };
      }
      case "new": {
        await this.stocktakeService.submitStocktakeDraft(
          session,
          choice.draft,
          {
            type: "shift",
            submissionId: submission._id,
            tenantId,
            submittedBy: submission.createdBy ?? null,
          },
        );
        const record = await this.stocktakes.findOne(
          reader,
          { submissionId: submission._id },
          { session },
        );
        return { stocktakeId: record?._id ?? null, skip: null };
      }
    }
  }

  // ---- 退回、完成 ----

  /** 退回 / 撤回:結帳單 → 已退回;自己建立的盤點單一起退回(打開時帶入原內容)。 */
  async markReturned(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const record = await this.checkouts.findOneAndUpdate(
      reader,
      { submissionId, status: CHECKOUT_STATUS.pending },
      { $set: { status: CHECKOUT_STATUS.returned }, $inc: { version: 1 } },
      { session },
    );
    if (record?.stocktakeMode === "new") {
      await this.stocktakeService.markStatus(
        session,
        tenantId,
        submissionId,
        "returned",
      );
    }
  }

  /**
   * 核准完成:套用自己建立的盤點單(沿用的那一筆有自己的核准),結帳單 → 已確認;
   * 零用金成為下一班期初(由 `registerHandoverAmount` 的登記讀結帳單,不另存)。
   */
  async apply(
    session: ClientSession,
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
  ): Promise<void> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const record = await this.checkouts.findOne(
      reader,
      { submissionId, status: CHECKOUT_STATUS.pending },
      { session },
    );
    if (record === null) {
      return;
    }
    if (record.stocktakeMode === "new") {
      await this.stocktakeService.apply(session, tenantId, submissionId);
    }
    await this.checkouts.findOneAndUpdate(
      reader,
      { _id: record._id, version: record.version },
      {
        $set: {
          status: CHECKOUT_STATUS.confirmed,
          confirmedAt: this.clock.now(),
          confirmedBy: await this.approverOf(tenantId, submissionId, session),
        },
        $inc: { version: 1 },
      },
      { session },
    );
    await this.support.publish({ orgId: record.orgId, tenantId });
  }

  /** 核准的人:目前流程實例裡最後核准的審核者;沒有(兩關都跳過)= 申請人。 */
  private async approverOf(
    tenantId: Types.ObjectId | null,
    submissionId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId | null> {
    if (tenantId === null) {
      return null;
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const submission = await this.submissions.findById(reader, submissionId, {
      session,
    });
    const instanceId = submission?.currentInstanceId ?? null;
    const [last] =
      instanceId === null
        ? []
        : await this.workflowTasks.findMany(
            tenantId,
            { instanceId, status: "approved" },
            { sort: { decidedAt: -1 }, limit: 1 },
          );
    return last?.assigneeId ?? submission?.createdBy ?? null;
  }

  /** 這一班「留給下一班」(`registerHandoverAmount` 的來源):最近一張結帳單;沒有 = 0。 */
  async handoverAmountOf(
    tenantId: Types.ObjectId | null,
    shiftId: Types.ObjectId,
  ): Promise<number> {
    if (tenantId === null) {
      return 0;
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const record = await this.checkouts.findOne(
      reader,
      { shiftId },
      { sort: { submittedAt: -1 }, select: "leftForNext" },
    );
    return record?.leftForNext ?? 0;
  }
}
