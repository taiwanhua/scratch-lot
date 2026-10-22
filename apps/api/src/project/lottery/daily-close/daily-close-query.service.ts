import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { localDayDiff } from "@repo/domain/form";
import {
  CHECKOUT_STATUS,
  STOCKTAKE_STATUS,
  STORE_PERMISSIONS,
  dailyCloseGapDates,
  isStocktakeReusable,
} from "@repo/domain/project/lottery";

import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { WorkflowTasksRepository } from "../../../database/workflow-tasks.repository";
import type { CheckoutCashItem } from "../../database/lottery-checkouts/lottery-checkout.schema";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { forbiddenError, notFoundError } from "../checkout/checkout-error";
import { CheckoutQueryService } from "../checkout/checkout-query.service";
import type { LotteryCheckoutCashItemModel } from "../checkout/models/checkout.model";
import { SettlementService } from "../settlement/settlement.service";
import { StoreShiftViews, parseId } from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { StoreSalesSupport } from "../store/store-sales-support";
import { type CheckoutRecord, DailyCloseLedger } from "./daily-close-ledger";
import type {
  LotteryDailyClosePendingModel,
  LotteryDailyCloseShiftRowModel,
  LotteryDailyCloseStatusModel,
  LotteryDailyCloseWizardModel,
} from "./models/daily-close.model";

const itemModelOf = (item: CheckoutCashItem): LotteryCheckoutCashItemModel => ({
  kind: item.kind,
  count: item.count,
  amount: item.amount,
  entries: item.entries.map((entry) => ({
    refType: entry.refType,
    refId: String(entry.refId),
    label: entry.label,
    occurredAt: entry.occurredAt,
    amount: entry.amount,
  })),
});

const STATE_OF: Readonly<Record<string, string>> = {
  [CHECKOUT_STATUS.confirmed]: "approved",
  [CHECKOUT_STATUS.pending]: "pending",
  [CHECKOUT_STATUS.returned]: "returned",
};

/**
 * 日結的讀取(專案規格 6.1、6.10;正本 `docs/modules/project/store.md`「日結與存銀行」):
 *
 * - `status`:看板頂部「上次日結:10/13(已 3 天)」、審核中的日結
 * - `wizard`:日結精靈(涵蓋計算期間、各班結帳與審核者、可沿用的全店盤點、小金庫應有逐項、可用的帳戶)
 *
 * 讀取照操作者的可見範圍;人名、單號、流程任務以租戶邊界反查(交班人可能是支援的人)。
 */
@Injectable()
export class DailyCloseQueryService {
  constructor(
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly workflowTasks: WorkflowTasksRepository,
    private readonly orgs: OrgsRepository,
    private readonly dailyLedger: DailyCloseLedger,
    private readonly checkoutQueries: CheckoutQueryService,
    private readonly settlement: SettlementService,
    private readonly views: StoreShiftViews,
    private readonly support: StoreSalesSupport,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  async status(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryDailyCloseStatusModel> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const [last, pending] = await Promise.all([
      this.dailyLedger.lastDaily(operator, store.orgId),
      this.dailyLedger.pendingDaily(operator, store.orgId),
    ]);
    const lastClosedAt = last?.coveredTo ?? null;
    let daysSince: number | null = null;
    if (lastClosedAt !== null) {
      const timezone = await tenantTimezoneOf(
        this.orgs,
        operator,
        store.tenantId,
      );
      daysSince = localDayDiff(lastClosedAt, this.clock.now(), timezone);
    }
    return {
      lastClosedAt,
      daysSince,
      pending: await this.pendingModelOf(operator, store.tenantId, pending),
    };
  }

  /**
   * 日結精靈:`submissionId` 給了 = 退回後再送出(涵蓋計算期間與班照原本那張;不把自己算成「另一張審核中的日結」)。
   */
  async wizard(
    operator: OperatorContext,
    orgIdText: string,
    submissionIdText: string | null,
  ): Promise<LotteryDailyCloseWizardModel> {
    const grant = await this.access.assertView(operator);
    if (!grant.has(STORE_PERMISSIONS.checkout)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.checkout}`);
    }
    const store = await this.support.mustStore(operator, orgIdText);
    const submissionId = parseId(submissionIdText);
    const own =
      submissionId === null
        ? null
        : await this.checkouts.findOne(operator, {
            submissionId,
            orgId: store.orgId,
          });
    if (submissionId !== null && own === null) {
      throw notFoundError(`daily close not found: ${submissionIdText ?? ""}`);
    }
    const now = this.clock.now();
    const timezone = await tenantTimezoneOf(
      this.orgs,
      operator,
      store.tenantId,
    );
    const last =
      own === null
        ? await this.dailyLedger.lastDaily(operator, store.orgId)
        : null;
    const coveredFrom =
      own === null ? (last?.coveredTo ?? null) : own.coveredFrom;
    const coveredTo = own?.coveredTo ?? null;
    const [org, openShifts, pending, shifts, vault, accounts, reusable] =
      await Promise.all([
        this.orgs.findById(operator, store.orgId),
        own === null
          ? this.dailyLedger.openShifts(operator, store.orgId)
          : Promise.resolve([]),
        this.dailyLedger.pendingDaily(operator, store.orgId, submissionId),
        own === null
          ? this.dailyLedger.coveredShifts(
              operator,
              store.orgId,
              coveredFrom,
              null,
            )
          : this.coveredShiftsOf(operator, own),
        this.dailyLedger.vaultCashOf(operator, store.tenantId, store.orgId),
        this.settlement.usableAccountsOf(operator, store.tenantId, store.orgId),
        this.reusableStocktakeOf(operator, store.tenantId, store.orgId, now),
      ]);
    const [rows, openRows] = await Promise.all([
      this.rowsOf(
        operator,
        store.tenantId,
        store.orgId,
        shifts.map((shift) => shift._id),
      ),
      this.openShiftModels(operator, store.tenantId, store.orgId, openShifts),
    ]);
    return {
      org: { id: String(store.orgId), name: org?.name ?? "" },
      coveredFrom,
      coveredTo,
      gapDates: dailyCloseGapDates(coveredFrom, coveredTo ?? now, timezone),
      openShifts: openRows,
      pending: await this.pendingModelOf(operator, store.tenantId, pending),
      shifts: rows,
      differenceTotal: rows.reduce((sum, row) => sum + row.difference, 0),
      canSubmit: grant.has(STORE_PERMISSIONS.checkout),
      canSkipStocktake: grant.has(STORE_PERMISSIONS.skipStocktake),
      reusableStocktake: reusable,
      vaultItems: vault.items.map((item) => itemModelOf(item)),
      vaultExpected: vault.expected,
      vaultBaselineAt: vault.baseline.since,
      bankAccounts: accounts.map((account) => ({
        id: account.id,
        name: account.label,
      })),
      serverNow: now,
    };
  }

  private async coveredShiftsOf(
    operator: OperatorContext,
    own: CheckoutRecord,
  ) {
    return this.dailyLedger.coveredShifts(
      operator,
      own.orgId,
      own.coveredFrom,
      own.coveredTo,
    );
  }

  /** 第 ① 步的列:每一班的交班結帳、狀態、等誰(審核者 / 要更正的人)、審核者是不是自己。 */
  private async rowsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    shiftIds: readonly Types.ObjectId[],
  ): Promise<LotteryDailyCloseShiftRowModel[]> {
    const byShift = await this.dailyLedger.shiftCheckoutsOf(operator, shiftIds);
    const checkouts = [...byShift.values()].toSorted(
      (a, b) => a.submittedAt.getTime() - b.submittedAt.getTime(),
    );
    if (checkouts.length === 0) {
      return [];
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const submissions = await this.submissions.findMany(
      reader,
      { _id: { $in: checkouts.map((row) => row.submissionId) } },
      { select: "serialNo currentInstanceId" },
    );
    const submissionOf = new Map(
      submissions.map((row) => [String(row._id), row]),
    );
    const instanceIds = submissions.flatMap((row) =>
      row.currentInstanceId == null ? [] : [row.currentInstanceId],
    );
    const tasks =
      instanceIds.length === 0
        ? []
        : await this.workflowTasks.findMany(tenantId, {
            instanceId: { $in: instanceIds },
            status: "pending",
          });
    const names = await this.views.userNames(operator, tenantId, [
      ...checkouts.flatMap((row) =>
        row.submittedBy === null ? [] : [row.submittedBy],
      ),
      ...tasks.map((task) => task.assigneeId),
    ]);
    const points = await this.support.cashPointsOf(reader, orgId);
    const pointName = (id: Types.ObjectId | null) =>
      id === null ? "" : (points.get(String(id))?.name ?? "");
    return checkouts.map((row) => {
      const submission = submissionOf.get(String(row.submissionId));
      const instanceId = submission?.currentInstanceId ?? null;
      const pendingTasks = tasks.filter(
        (task) =>
          instanceId !== null && String(task.instanceId) === String(instanceId),
      );
      const state = STATE_OF[row.status] ?? "pending";
      const applicant =
        row.submittedBy === null
          ? null
          : {
              id: String(row.submittedBy),
              name: names.get(String(row.submittedBy)) ?? "",
            };
      let waitingFor: string[] = [];
      if (state === "pending") {
        waitingFor = pendingTasks.map(
          (task) => names.get(String(task.assigneeId)) ?? "",
        );
      } else if (state === "returned" && applicant !== null) {
        waitingFor = [applicant.name];
      }
      return {
        shiftId: String(row.shiftId),
        submissionId: String(row.submissionId),
        serialNo: submission?.serialNo ?? null,
        instanceId: instanceId === null ? null : String(instanceId),
        cashPoint: {
          id: String(row.cashPointId),
          name: pointName(row.cashPointId),
        },
        submittedBy: applicant,
        submittedAt: row.submittedAt,
        expected: row.expected,
        counted: row.counted,
        difference: row.difference,
        state,
        waitingFor,
        isMine:
          state === "pending" &&
          operator.actorId !== null &&
          pendingTasks.some(
            (task) => String(task.assigneeId) === String(operator.actorId),
          ),
      };
    });
  }

  private async openShiftModels(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    shifts: readonly {
      cashPointId: Types.ObjectId;
      openedBy: Types.ObjectId;
    }[],
  ) {
    if (shifts.length === 0) {
      return [];
    }
    const [points, names] = await Promise.all([
      this.support.cashPointsOf(operator, orgId),
      this.views.userNames(
        operator,
        tenantId,
        shifts.map((shift) => shift.openedBy),
      ),
    ]);
    return shifts.map((shift) => ({
      cashPointName: points.get(String(shift.cashPointId))?.name ?? "",
      ownerName: names.get(String(shift.openedBy)) ?? "",
    }));
  }

  /** 可以沿用的全店盤點:這家店最近一張範圍是全店、待核准或已確認、30 分鐘內。 */
  private async reusableStocktakeOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    orgId: Types.ObjectId,
    now: Date,
  ) {
    const record = await this.stocktakes.findOne(
      operator,
      {
        orgId,
        scopeCashPointId: null,
        status: { $in: [STOCKTAKE_STATUS.pending, STOCKTAKE_STATUS.confirmed] },
      },
      { sort: { startedAt: -1 } },
    );
    if (record === null || !isStocktakeReusable(record.startedAt, now)) {
      return null;
    }
    return this.checkoutQueries.stocktakeRefOf(operator, tenantId, record);
  }

  private async pendingModelOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    record: CheckoutRecord | null,
  ): Promise<LotteryDailyClosePendingModel | null> {
    if (record === null) {
      return null;
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const submission = await this.submissions.findById(
      reader,
      record.submissionId,
      { select: "serialNo" },
    );
    return {
      submissionId: String(record.submissionId),
      serialNo: submission?.serialNo ?? null,
      status: record.status,
    };
  }
}
