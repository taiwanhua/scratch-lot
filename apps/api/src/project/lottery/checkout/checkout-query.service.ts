import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { compareDisplayName } from "@repo/domain/collation";
import {
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_TYPE,
  CHECKOUT_TYPES,
  type CheckoutDraft,
  type DailyCloseDraft,
  REDEMPTION_STATUS,
  STOCKTAKE_REUSE_MINUTES,
  STOCKTAKE_STATUS,
  STORE_KEY,
  STORE_PERMISSIONS,
  expectedCashTotalOf,
  isStocktakeReusable,
  serializeCheckoutDraft,
  serializeDailyCloseDraft,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import {
  FormSubmissionsRepository,
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { RelationService } from "../../../database/relation.service";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { FormAccessService } from "../../../forms/form-access.service";
import { SubmissionReadAccess } from "../../../workflows/workflow-engine/submission-read-access.service";
import { LotteryBankAccountsRepository } from "../../database/lottery-accounts/lottery-accounts.repositories";
import type {
  CheckoutCashItem,
  CheckoutPendingImpact,
} from "../../database/lottery-checkouts/lottery-checkout.schema";
import {
  type LotteryCheckoutDocument,
  LotteryCheckoutsRepository,
} from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import {
  type LotteryStocktakeDocument,
  LotteryStocktakesRepository,
} from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { RedemptionViews } from "../redemption/redemption-views";
import { draftOfStocktake } from "../stocktake/stocktake-query.service";
import {
  type ShiftRecord,
  StoreShiftViews,
  parseId,
} from "../store/shift-views";
import { StoreAccess } from "../store/store-access";
import { StoreClock } from "../store/store-clock";
import { StoreFormsQueryService } from "../store/store-forms-query.service";
import { StoreSalesSupport } from "../store/store-sales-support";
import { forbiddenError, notFoundError } from "./checkout-error";
import { CheckoutService } from "./checkout.service";
import type { LotteryCheckoutsInput } from "./dto/checkout.input";
import { ExpectedCashItems } from "./expected-cash";
import type {
  LotteryCheckoutCashItemModel,
  LotteryCheckoutDetailModel,
  LotteryCheckoutListItemModel,
  LotteryCheckoutPendingImpactModel,
  LotteryCheckoutReusableStocktakeModel,
  LotteryCheckoutWizardModel,
  LotteryCheckoutsPayload,
} from "./models/checkout.model";

type CheckoutRecord = Persisted<LotteryCheckoutDocument>;

const LIST_LIMIT_MAX = 100;

/** 列表的「狀態」篩選只收申請的這幾種狀態。 */
const LISTED_SUBMISSION_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
] as const;
type ListedSubmissionStatus = (typeof LISTED_SUBMISSION_STATUSES)[number];

const isListedStatus = (value: string): value is ListedSubmissionStatus =>
  (LISTED_SUBMISSION_STATUSES as readonly string[]).includes(value);

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

const impactModelOf = (
  impact: CheckoutPendingImpact,
): LotteryCheckoutPendingImpactModel => ({
  submissionId: String(impact.submissionId),
  formKey: impact.formKey,
  serialNo: impact.serialNo,
  amount: impact.amount,
});

/**
 * 交班結帳的讀取(專案規格 6.9、8.7;正本 `docs/modules/project/store.md`「交班結帳」):
 *
 * - `wizard`:交班精靈的資料(這一班、可沿用的盤點、兌獎、應有現金逐項、審核中的單據、接班人候選)
 * - `list` / `detail`:班次結帳歷史紀錄分頁、結帳確認申請檢視頁
 *
 * 讀取要 `store.view`(精靈另要 `store.checkout`),照操作者的可見範圍;人名以租戶邊界反查。
 */
@Injectable()
export class CheckoutQueryService {
  constructor(
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly bankAccounts: LotteryBankAccountsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly users: UsersRepository,
    private readonly orgs: OrgsRepository,
    private readonly relations: RelationService,
    private readonly formAccess: FormAccessService,
    private readonly readAccess: SubmissionReadAccess,
    private readonly support: StoreSalesSupport,
    private readonly views: StoreShiftViews,
    private readonly redemptionViews: RedemptionViews,
    private readonly storeForms: StoreFormsQueryService,
    private readonly expectedCash: ExpectedCashItems,
    private readonly checkout: CheckoutService,
    private readonly access: StoreAccess,
    private readonly clock: StoreClock,
  ) {}

  // ---- 交班精靈 ----

  async wizard(
    operator: OperatorContext,
    shiftIdText: string,
  ): Promise<LotteryCheckoutWizardModel> {
    const grant = await this.access.assertView(operator);
    if (!grant.has(STORE_PERMISSIONS.checkout)) {
      throw forbiddenError(`Missing permission ${STORE_PERMISSIONS.checkout}`);
    }
    const shiftId = parseId(shiftIdText);
    const shift =
      shiftId === null ? null : await this.shifts.findById(operator, shiftId);
    if (shift === null) {
      throw notFoundError(`shift not found: ${shiftIdText}`);
    }
    const now = this.clock.now();
    const [points, names, items, pending, redemptionRows, reusable, members] =
      await Promise.all([
        this.support.cashPointsOf(operator, shift.orgId),
        this.views.userNames(operator, shift.tenantId, [shift.openedBy]),
        this.expectedCash.of(operator, shift),
        this.storeForms.pendingCashImpacts(operator, shift._id),
        this.redemptions.findMany(
          operator,
          {
            shiftId: shift._id,
            postCloseOf: null,
            status: { $ne: REDEMPTION_STATUS.revoked },
          },
          { sort: { redeemedAt: 1, _id: 1 } },
        ),
        this.reusableStocktakeOf(operator, shift, now),
        this.successorOptions(operator, shift),
      ]);
    const redemptions = await this.redemptionViews.toModels(
      operator,
      redemptionRows,
      grant,
    );
    return {
      shift: {
        id: String(shift._id),
        orgId: String(shift.orgId),
        cashPoint: {
          id: String(shift.cashPointId),
          name: points.get(String(shift.cashPointId))?.name ?? "",
        },
        openedBy: {
          id: String(shift.openedBy),
          name: names.get(String(shift.openedBy)) ?? "",
        },
        openedAt: shift.openedAt,
        closed: shift.closedAt !== null,
      },
      canSubmit: this.checkout.canCheckout(operator, grant, shift),
      canSkipStocktake: grant.has(STORE_PERMISSIONS.skipStocktake),
      reusableStocktake: reusable,
      redemptions,
      redemptionTotal: redemptionRows.reduce(
        (sum, row) => sum + row.prizeAmount,
        0,
      ),
      expectedItems: items.map((item) => itemModelOf(item)),
      expected: expectedCashTotalOf(items),
      pendingImpacts: pending.map((impact) => impactModelOf(impact)),
      successorOptions: members,
      serverNow: now,
    };
  }

  /** 可以沿用的盤點:這家店最近一張、範圍是這個收銀點或全店、待核准或已確認(已退回 / 已駁回不行)、30 分鐘內。 */
  private async reusableStocktakeOf(
    operator: OperatorContext,
    shift: ShiftRecord,
    now: Date,
  ): Promise<LotteryCheckoutReusableStocktakeModel | null> {
    const record = await this.stocktakes.findOne(
      operator,
      {
        orgId: shift.orgId,
        status: { $in: [STOCKTAKE_STATUS.pending, STOCKTAKE_STATUS.confirmed] },
        $or: [
          { scopeCashPointId: null },
          { scopeCashPointId: shift.cashPointId },
        ],
        // 只看 30 分鐘內(含)開始的(`isStocktakeReusable` 同一個窗):比「現在」晚開始的不算最近一張
        startedAt: {
          $gte: new Date(now.getTime() - STOCKTAKE_REUSE_MINUTES * 60_000),
          $lte: now,
        },
      },
      { sort: { startedAt: -1 } },
    );
    if (record === null || !isStocktakeReusable(record.startedAt, now)) {
      return null;
    }
    return this.stocktakeRefOf(operator, shift.tenantId, record);
  }

  async stocktakeRefOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    record: {
      submissionId: Types.ObjectId;
      startedAt: Date;
      scopeCashPointId: Types.ObjectId | null;
      lines: { diffs: unknown[] }[];
      orgId: Types.ObjectId;
    },
  ): Promise<LotteryCheckoutReusableStocktakeModel> {
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const [submission, points] = await Promise.all([
      this.submissions.findById(reader, record.submissionId, {
        select: "serialNo",
      }),
      this.support.cashPointsOf(reader, record.orgId),
    ]);
    return {
      submissionId: String(record.submissionId),
      serialNo: submission?.serialNo ?? null,
      startedAt: record.startedAt,
      scopeName:
        record.scopeCashPointId === null
          ? null
          : (points.get(String(record.scopeCashPointId))?.name ?? ""),
      diffCount: record.lines.reduce((sum, line) => sum + line.diffs.length, 0),
    };
  }

  /** 接班人候選:這家店啟用中的成員,不含自己與這一班的負責人(接班人 = 下一班的人);名稱排序。 */
  private async successorOptions(
    operator: OperatorContext,
    shift: ShiftRecord,
  ): Promise<{ id: string; name: string }[]> {
    const members = await this.relations.listUserIdsOfOrg(shift.orgId);
    const ids = members.filter(
      (id) =>
        !id.equals(shift.openedBy) &&
        (operator.actorId === null || !id.equals(operator.actorId)),
    );
    if (ids.length === 0) {
      return [];
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      shift.tenantId,
    );
    const found = await this.users.findMany(reader, {
      _id: { $in: ids },
      enabled: true,
    });
    return found
      .map((user) => ({ id: String(user._id), name: user.name }))
      .toSorted((a, b) => compareDisplayName(a.name, b.name));
  }

  // ---- 班次結帳歷史紀錄、檢視頁 ----

  async list(
    operator: OperatorContext,
    input: LotteryCheckoutsInput,
  ): Promise<LotteryCheckoutsPayload> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, input.orgId);
    const filter: Record<string, unknown> = { orgId: store.orgId };
    if (input.from != null || input.to != null) {
      filter.submittedAt = {
        ...(input.from == null ? {} : { $gte: input.from }),
        ...(input.to == null ? {} : { $lte: input.to }),
      };
    }
    const cashPointId = parseId(input.cashPointId);
    if (cashPointId !== null) {
      filter.cashPointId = cashPointId;
    }
    if (
      input.type != null &&
      (CHECKOUT_TYPES as readonly string[]).includes(input.type)
    ) {
      filter.type = input.type;
    }
    const status =
      input.status != null && isListedStatus(input.status)
        ? input.status
        : null;
    if (status !== null) {
      // 狀態存在申請上:先找這家店符合狀態的申請,再限縮結帳單
      const reader = await tenantBoundaryContext(
        this.orgs,
        operator,
        store.tenantId,
      );
      const matched = await this.submissions.findMany(
        reader,
        { moduleKey: STORE_KEY, formKey: CHECKOUT_CONFIRM_FORM_KEY, status },
        { select: "_id" },
      );
      filter.submissionId = { $in: matched.map((row) => row._id) };
    }
    const limit = Math.min(Math.max(input.limit ?? 20, 1), LIST_LIMIT_MAX);
    const offset = Math.max(input.offset ?? 0, 0);
    const [records, total] = await Promise.all([
      this.checkouts.findMany(operator, filter, {
        sort: { submittedAt: -1, _id: -1 },
        skip: offset,
        limit,
      }),
      this.checkouts.count(operator, filter),
    ]);
    const [submissions, points, names] = await Promise.all([
      this.submissionsOf(operator, store.tenantId, records),
      this.support.cashPointsOf(operator, store.orgId),
      this.views.userNames(
        operator,
        store.tenantId,
        records.flatMap((record) =>
          record.submittedBy === null ? [] : [record.submittedBy],
        ),
      ),
    ]);
    return {
      total,
      items: records.map((record): LotteryCheckoutListItemModel => {
        const submission = submissions.get(String(record.submissionId));
        return {
          id: String(record._id),
          submissionId: String(record.submissionId),
          serialNo: submission?.serialNo ?? null,
          type: record.type,
          status: record.status,
          submissionStatus: submission?.status ?? "",
          cashPoint:
            record.cashPointId === null
              ? null
              : {
                  id: String(record.cashPointId),
                  name: points.get(String(record.cashPointId))?.name ?? "",
                },
          submittedBy:
            record.submittedBy === null
              ? null
              : {
                  id: String(record.submittedBy),
                  name: names.get(String(record.submittedBy)) ?? "",
                },
          expected: record.expected,
          counted: record.counted,
          difference: record.difference,
          submittedAt: record.submittedAt,
        };
      }),
    };
  }

  async detail(
    operator: OperatorContext,
    submissionIdText: string,
  ): Promise<LotteryCheckoutDetailModel> {
    await this.access.assertView(operator);
    const submissionId = parseId(submissionIdText);
    // 審核者(接班人、店長)可能從申請中心進來:讀得到那張申請 = 讀得到結帳單(以租戶邊界反查)
    const record =
      submissionId === null
        ? null
        : await this.readableCheckout(operator, submissionId);
    if (record === null) {
      throw notFoundError(`checkout not found: ${submissionIdText}`);
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      record.tenantId,
    );
    const [org, points, names, stocktake, shift] = await Promise.all([
      this.orgs.findById(reader, record.orgId),
      this.support.cashPointsOf(reader, record.orgId),
      this.views.userNames(
        operator,
        record.tenantId,
        [record.submittedBy, record.successorId].flatMap((id) =>
          id === null ? [] : [id],
        ),
      ),
      record.stocktakeId === null
        ? null
        : this.stocktakes.findById(reader, record.stocktakeId),
      // 結帳單列印的「班次」(開班 ~ 結束)
      record.shiftId === null
        ? null
        : this.shifts.findById(reader, record.shiftId),
    ]);
    const daily = await this.dailyFactsOf(reader, record, points);
    const nameRef = (id: Types.ObjectId | null) =>
      id === null
        ? null
        : { id: String(id), name: names.get(String(id)) ?? "" };
    return {
      id: String(record._id),
      submissionId: String(record.submissionId),
      type: record.type,
      status: record.status,
      orgId: String(record.orgId),
      orgName: org?.name ?? "",
      cashPoint:
        record.cashPointId === null
          ? null
          : {
              id: String(record.cashPointId),
              name: points.get(String(record.cashPointId))?.name ?? "",
            },
      shiftId: record.shiftId === null ? null : String(record.shiftId),
      cashPointPrinterId: printerIdOf(
        record.cashPointId === null
          ? null
          : points.get(String(record.cashPointId)),
      ),
      shiftOpenedAt: shift?.openedAt ?? null,
      shiftClosedAt: shift?.closedAt ?? null,
      stocktakeMode: record.stocktakeMode,
      stocktake:
        stocktake === null
          ? null
          : await this.stocktakeRefOf(operator, record.tenantId, stocktake),
      skipReason: record.skipReason,
      skipReasonNote: record.skipReasonNote,
      expectedItems: record.expectedItems.map((item) => itemModelOf(item)),
      expected: record.expected,
      denominations: record.denominations.map((row) => ({
        value: row.value,
        count: row.count,
      })),
      counted: record.counted,
      difference: record.difference,
      diffReason: record.diffReason,
      diffReasonNote: record.diffReasonNote,
      pendingImpacts: record.pendingImpacts.map((impact) =>
        impactModelOf(impact),
      ),
      leftForNext: record.leftForNext,
      successor: nameRef(record.successorId),
      submittedBy: nameRef(record.submittedBy),
      submittedAt: record.submittedAt,
      confirmedAt: record.confirmedAt,
      ...daily,
      draft:
        record.type === CHECKOUT_TYPE.daily
          ? serializeDailyCloseDraft(this.dailyDraftOf(record, stocktake))
          : serializeCheckoutDraft(this.draftOf(record, stocktake)),
    };
  }

  /** 日結的檢視頁欄位:涵蓋計算期間、涵蓋的班(單號、收銀點)、存入銀行;交班 = 空。 */
  private async dailyFactsOf(
    reader: OperatorContext,
    record: CheckoutRecord,
    points: Map<string, { name: string }>,
  ) {
    if (record.type !== CHECKOUT_TYPE.daily) {
      return {
        coveredFrom: null,
        coveredTo: null,
        coveredShifts: [],
        bankDepositAmount: 0,
        bankAccount: null,
      };
    }
    const [shiftCheckouts, account] = await Promise.all([
      record.coveredShiftIds.length === 0
        ? []
        : this.checkouts.findMany(
            reader,
            {
              shiftId: { $in: record.coveredShiftIds },
              type: CHECKOUT_TYPE.shift,
            },
            { sort: { submittedAt: 1 } },
          ),
      record.bankAccountId === null
        ? null
        : this.bankAccounts.findById(reader, record.bankAccountId),
    ]);
    const serials = await this.submissionsOf(
      reader,
      record.tenantId,
      shiftCheckouts,
    );
    return {
      coveredFrom: record.coveredFrom,
      coveredTo: record.coveredTo,
      coveredShifts: shiftCheckouts.map((row) => ({
        submissionId: String(row.submissionId),
        serialNo: serials.get(String(row.submissionId))?.serialNo ?? null,
        cashPointName: points.get(String(row.cashPointId))?.name ?? "",
        difference: row.difference,
      })),
      bankDepositAmount: record.bankDepositAmount,
      bankAccount:
        account === null
          ? null
          : { id: String(account._id), name: account.label },
    };
  }

  /** 日結的結帳單 → 結帳內容(退回後打開日結精靈帶入)。 */
  private dailyDraftOf(
    record: CheckoutRecord,
    stocktake: Persisted<LotteryStocktakeDocument> | null,
  ): DailyCloseDraft {
    const shiftShaped = this.draftOf(record, stocktake);
    return {
      version: 1,
      type: CHECKOUT_TYPE.daily,
      orgId: String(record.orgId),
      stocktake: shiftShaped.stocktake,
      denominations: shiftShaped.denominations,
      diffReasonKey: record.diffReasonKey,
      diffReasonNote: record.diffReasonNote,
      bankDeposit: {
        amount: record.bankDepositAmount,
        accountId:
          record.bankAccountId === null ? null : String(record.bankAccountId),
      },
    };
  }

  /** 結帳單 → 結帳內容(退回後打開精靈帶入原內容);`stocktake` = 結帳單指的盤點單(沿用的或自己建立的)。 */
  private draftOf(
    record: CheckoutRecord,
    stocktake: Persisted<LotteryStocktakeDocument> | null,
  ): CheckoutDraft {
    const stocktakeDraft =
      stocktake === null ? null : draftOfStocktake(stocktake);
    const base = {
      version: 1 as const,
      type: "shift" as const,
      orgId: String(record.orgId),
      shiftId: String(record.shiftId),
      cashPointId: String(record.cashPointId),
      denominations: record.denominations.map((row) => ({
        value: row.value,
        count: row.count,
      })),
      diffReasonKey: record.diffReasonKey,
      diffReasonNote: record.diffReasonNote,
      leftForNext: record.leftForNext,
      successorId:
        record.successorId === null ? null : String(record.successorId),
    };
    if (record.stocktakeMode === "skip") {
      return {
        ...base,
        stocktake: {
          mode: "skip",
          reasonKey: record.skipReasonKey ?? "",
          reasonNote: record.skipReasonNote,
        },
      };
    }
    if (record.stocktakeMode === "new" && stocktakeDraft !== null) {
      const parsed = JSON.parse(stocktakeDraft) as CheckoutDraft["stocktake"] &
        Record<string, unknown>;
      return {
        ...base,
        stocktake: {
          mode: "new",
          draft: parsed as never,
        },
      };
    }
    return {
      ...base,
      stocktake: {
        mode: "reuse",
        submissionId: stocktake === null ? "" : String(stocktake.submissionId),
      },
    };
  }

  /** 結帳單:操作者看得到那家店,或讀得到那張申請(審核者從申請中心進來)。 */
  private async readableCheckout(
    operator: OperatorContext,
    submissionId: Types.ObjectId,
  ): Promise<CheckoutRecord | null> {
    const own = await this.checkouts.findOne(operator, { submissionId });
    if (own !== null) {
      return own;
    }
    const facts = await this.formAccess.factsOf(operator);
    const submission = await this.readAccess.findInTenant(facts, submissionId);
    if (submission === null) {
      return null;
    }
    const readable = await this.readAccess.readableRevisions(facts, submission);
    if (readable.kind === "none") {
      return null;
    }
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      submission.tenantId,
    );
    return this.checkouts.findOne(reader, { submissionId });
  }

  private async submissionsOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    records: readonly CheckoutRecord[],
  ): Promise<Map<string, { serialNo: string | null; status: string }>> {
    if (records.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const found = await this.submissions.findMany(
      reader,
      { _id: { $in: records.map((record) => record.submissionId) } },
      { select: "serialNo status" },
    );
    return new Map(
      found.map((row) => [
        String(row._id),
        { serialNo: row.serialNo, status: row.status },
      ]),
    );
  }
}

/** 收銀點的印表機 id(單據列印的預設;沒有收銀點或沒設定 = null)。 */
function printerIdOf(
  point: { printerId?: Types.ObjectId | null } | null | undefined,
): string | null {
  const printerId = point?.printerId ?? null;
  return printerId === null ? null : String(printerId);
}
