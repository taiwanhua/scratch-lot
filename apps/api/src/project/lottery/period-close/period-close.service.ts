import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  type StoredValues,
  localMonthOf,
  localMonthRange,
  localMonthText,
  parseLocalMonth,
} from "@repo/domain/form";
import {
  CASH_CORRECTION_FORM_KEY,
  CASH_CORRECTION_PLACE,
  CHECKOUT_STATUS,
  CHECKOUT_TYPE,
  SALE_REVERSAL_FORM_KEY,
  STORE_KEY,
  cashCorrectionValuesOf,
  saleReversalValuesOf,
} from "@repo/domain/project/lottery";
import {
  type PeriodPendingKind,
  isPeriodEnded,
  nextClosableMonth,
  periodMonthsOf,
} from "@repo/domain/project/lottery-accounts";

import { AuditService } from "../../../audit/audit.service";
import { FormSubmissionsRepository } from "../../../database/base/repositories";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  LotteryBankAccountsRepository,
  LotteryPeriodClosesRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import type {
  LotteryPeriodClose,
  PeriodCloseSnapshot,
  PeriodCloseStoreSnapshot,
} from "../../database/lottery-accounts/lottery-period-close.schema";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { AccountsAccess } from "../accounts/accounts-access";
import {
  ACCOUNTS_REASONS,
  isDuplicateKeyError,
  notFoundError,
  validationError,
} from "../accounts/accounts-error";
import { BankTransactionsService } from "../accounts/bank-transactions.service";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { DailyCloseLedger } from "../daily-close/daily-close-ledger";
import { StoreShiftViews } from "../store/shift-views";
import { StoreClock } from "../store/store-clock";
import type { CloseLotteryPeriodInput } from "./dto/period-close.input";
import type {
  LotteryPeriodCloseCheckModel,
  LotteryPeriodCloseModel,
  LotteryPeriodClosesModel,
  LotteryPeriodOpenShiftModel,
  LotteryPeriodPendingDocumentModel,
  LotteryPeriodSnapshotModel,
} from "./models/period-close.model";

/** 稽核的 targetType 與動作名(模組文件「稽核」節)。 */
export const PERIOD_CLOSE_AUDIT = {
  target: "lottery_period_close",
  close: "lottery-period.close",
} as const;

/** 擋下關帳的單據狀態:審核中、已退回待更正(還會再送出;規格 10.4 的「審核中」)。 */
const UNFINISHED_SUBMISSION_STATUSES = ["reviewing", "returned"] as const;
const UNFINISHED_CHECKOUT_STATUSES = [
  CHECKOUT_STATUS.pending,
  CHECKOUT_STATUS.returned,
];

/** 一個租戶、一個月份的範圍。 */
interface Period {
  tenantId: Types.ObjectId;
  reader: OperatorContext;
  timezone: string;
  month: string;
  start: Date;
  end: Date;
}

/** 讀到的班(只取要的欄位)。 */
interface ShiftRow {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  cashPointId: Types.ObjectId;
  openedAt: Date;
  closedAt: Date | null;
  checkoutId: Types.ObjectId | null;
  label: string;
}

const SHIFT_SELECT = "orgId cashPointId openedAt closedAt checkoutId label";

const toObjectId = (text: string | null): Types.ObjectId | null =>
  text !== null && Types.ObjectId.isValid(text)
    ? new Types.ObjectId(text)
    : null;

/** 一張擋下關帳的單據(還沒補上分店名稱與單號)。 */
type PendingFound = Omit<LotteryPeriodPendingDocumentModel, "orgName"> & {
  orgId: Types.ObjectId;
};

const inPeriod = (period: Period, at: Date) =>
  at >= period.start && at < period.end;

/** 店面兩張表單用哪一班判斷(退款班次 / 位置那一班);位置是小金庫 → 用送出時間。 */
function placeOf(row: { formKey: string; values: StoredValues }): {
  kind: PeriodPendingKind;
  shiftId: Types.ObjectId | null;
  isVault: boolean;
} {
  if (row.formKey === SALE_REVERSAL_FORM_KEY) {
    const values = saleReversalValuesOf(row.values);
    return {
      kind: "sale_reversal",
      shiftId: values.refund ? toObjectId(values.refundShiftId) : null,
      isVault: false,
    };
  }
  const values = cashCorrectionValuesOf(row.values);
  const isDrawer = values.place === CASH_CORRECTION_PLACE.drawer;
  return {
    kind: "cash_correction",
    shiftId: isDrawer ? toObjectId(values.shiftId) : null,
    isVault: values.place === CASH_CORRECTION_PLACE.vault,
  };
}

/**
 * 關帳(專案規格 10.4、3.4;正本 `docs/modules/project/accounts.md`「關帳」):月份列表、檢查清單 + 快照預覽、
 * [關帳] 與已關帳月份的快照。範圍是**整個租戶**(以租戶邊界上下文讀;resolver 守 `accounts.close-period`)。
 *
 * - 依序關帳、只能關已結束的月份、永遠關到該月最後一刻(期間 = 當地 1 日 00:00 至 下月 1 日 00:00,不含)、不能重新開帳
 * - **擋**:那個月有沒結帳的收銀班次(開班時間在月底前、還沒送出交班結帳);下表三種單據審核中(含已退回待更正)
 *   且時間落在那個月 —— 撤銷售出申請(退款 = 是:退款班次的開班時間)、現金更正單(位置是某一班:那一班的開班時間;
 *   小金庫:送出時間)、結帳確認申請(交班:那一班與該月重疊;日結:涵蓋計算期間與該月重疊)
 * - **只警告**(記入快照):那個月開的班沒有被日結涵蓋計算
 */
@Injectable()
export class PeriodCloseService {
  constructor(
    private readonly closes: LotteryPeriodClosesRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly accounts: LotteryBankAccountsRepository,
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly ledger: CashLedgerService,
    private readonly bankTransactions: BankTransactionsService,
    private readonly dailyLedger: DailyCloseLedger,
    private readonly access: AccountsAccess,
    private readonly views: StoreShiftViews,
    private readonly clock: StoreClock,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
  ) {}

  /** 月份列表(AC-06):起始月份(租戶開始使用的月份)到本月,新的在前。 */
  async list(operator: OperatorContext): Promise<LotteryPeriodClosesModel> {
    const tenant = await this.tenantOf(operator);
    if (tenant === null) {
      return { items: [], closableMonth: null };
    }
    const now = this.clock.now().getTime();
    const closed = await this.closes.findMany(
      tenant.reader,
      {},
      { sort: { periodEnd: -1 } },
    );
    const names = await this.views.userNames(
      operator,
      tenant.tenantId,
      closed.map((row) => row.closedBy),
    );
    const byMonth = new Map(closed.map((row) => [row.month, row]));
    const closableMonth = nextClosableMonth({
      lastClosed: closed[0]?.month ?? null,
      firstMonth: tenant.firstMonth,
      now,
      timezone: tenant.timezone,
    });
    const items = periodMonthsOf({
      firstMonth: tenant.firstMonth,
      closed: closed.map((row) => row.month),
      now,
      timezone: tenant.timezone,
    }).map(({ month, status }) => {
      const row = byMonth.get(month);
      return {
        month,
        status,
        closedAt: row?.closedAt ?? null,
        closedBy:
          row === undefined
            ? null
            : {
                id: String(row.closedBy),
                name: names.get(String(row.closedBy)) ?? "",
              },
        canClose: month === closableMonth,
      };
    });
    return { items, closableMonth };
  }

  /** 關帳彈窗(AC-07):檢查清單 + 快照預覽。 */
  async check(
    operator: OperatorContext,
    month: string,
  ): Promise<LotteryPeriodCloseCheckModel> {
    const period = await this.periodOf(operator, month);
    const [openShifts, pendingDocuments, snapshot, closable] =
      await Promise.all([
        this.openShiftsOf(period),
        this.pendingDocumentsOf(period),
        this.snapshotOf(period),
        this.closableMonthOf(period),
      ]);
    return {
      month,
      openShifts,
      pendingDocuments,
      snapshot: snapshotModelOf(snapshot),
      canClose:
        closable === month &&
        openShifts.length === 0 &&
        pendingDocuments.length === 0,
    };
  }

  /** 已關帳月份的快照([快照])。 */
  async get(
    operator: OperatorContext,
    month: string,
  ): Promise<LotteryPeriodCloseModel> {
    const tenant = await this.tenantOf(operator);
    const row =
      tenant === null || parseLocalMonth(month) === null
        ? null
        : await this.closes.findOne(tenant.reader, { month });
    if (tenant === null || row === null) {
      throw notFoundError("period close not found");
    }
    return this.modelOf(operator, tenant.tenantId, row);
  }

  /**
   * [關帳]:輸入的月份確認要相同;已關 / 沒結束 / 不依序 / 有擋下的項目 → `VALIDATION_FAILED` + `reason`。
   * 建立關帳紀錄(快照)與稽核在同一個交易;兩人同時關同一個月由唯一索引擋下後到的。
   */
  async close(
    operator: OperatorContext,
    input: CloseLotteryPeriodInput,
  ): Promise<LotteryPeriodCloseModel> {
    const actorId = operator.actorId;
    if (actorId === null) {
      throw validationError("operator required", ["month"]);
    }
    if (input.confirmMonth.trim() !== input.month) {
      throw validationError(
        "confirm month does not match",
        ["confirmMonth"],
        ACCOUNTS_REASONS.invalid,
      );
    }
    const period = await this.periodOf(operator, input.month);
    const existing = await this.closes.findOne(period.reader, {
      month: period.month,
    });
    if (existing !== null) {
      throw alreadyClosed();
    }
    if (
      !isPeriodEnded(period.month, this.clock.now().getTime(), period.timezone)
    ) {
      throw validationError(
        `${period.month} has not ended`,
        ["month"],
        ACCOUNTS_REASONS.notEnded,
      );
    }
    if ((await this.closableMonthOf(period)) !== period.month) {
      throw validationError(
        `${period.month} is not the earliest open period`,
        ["month"],
        ACCOUNTS_REASONS.outOfOrder,
      );
    }
    const openShifts = await this.openShiftsOf(period);
    if (openShifts.length > 0) {
      throw validationError(
        `${period.month} has shifts without checkout`,
        ["month"],
        ACCOUNTS_REASONS.shiftsNotClosed,
      );
    }
    const pending = await this.pendingDocumentsOf(period);
    if (pending.length > 0) {
      throw validationError(
        `${period.month} has documents under review`,
        ["month"],
        ACCOUNTS_REASONS.pendingDocuments,
      );
    }
    const snapshot = await this.snapshotOf(period);
    const writer: OperatorContext = {
      ...period.reader,
      actorId,
    };
    const note = input.note?.trim() ?? "";
    let created: Awaited<ReturnType<LotteryPeriodClosesRepository["create"]>>;
    try {
      created = await this.transactions.withTransaction(async () => {
        const row = await this.closes.create(writer, {
          orgId: period.tenantId,
          month: period.month,
          periodStart: period.start,
          periodEnd: period.end,
          closedAt: this.clock.now(),
          closedBy: actorId,
          note: note === "" ? null : note,
          snapshot,
        } satisfies Partial<LotteryPeriodClose>);
        await this.audit.record(writer, {
          action: PERIOD_CLOSE_AUDIT.close,
          targetType: PERIOD_CLOSE_AUDIT.target,
          targetId: row._id,
          after: { month: period.month },
        });
        return row;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw alreadyClosed();
      }
      throw error;
    }
    return this.modelOf(operator, period.tenantId, created);
  }

  // ---- 內部 ----

  /** 操作者所在的租戶(根組織 = null)、租戶時區、起始月份;讀以租戶邊界上下文。 */
  private async tenantOf(operator: OperatorContext): Promise<{
    tenantId: Types.ObjectId;
    reader: OperatorContext;
    timezone: string;
    firstMonth: string;
  } | null> {
    const { tenantId } = await this.access.grantOf(operator);
    if (tenantId === null) {
      return null;
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const timezone = await tenantTimezoneOf(this.orgs, reader, tenantId);
    const org = await this.orgs.findById(reader, tenantId, {
      select: "createdAt",
    });
    const startedAt = (org as { createdAt?: Date } | null)?.createdAt;
    const firstMonth = localMonthText(
      localMonthOf((startedAt ?? this.clock.now()).getTime(), timezone),
    );
    return { tenantId, reader, timezone, firstMonth };
  }

  private async periodOf(
    operator: OperatorContext,
    month: string,
  ): Promise<Period & { firstMonth: string }> {
    const parsed = parseLocalMonth(month);
    if (parsed === null) {
      throw validationError(
        "month must be YYYY-MM",
        ["month"],
        ACCOUNTS_REASONS.invalid,
      );
    }
    const tenant = await this.tenantOf(operator);
    if (tenant === null) {
      throw notFoundError("tenant not found");
    }
    const range = localMonthRange(parsed, tenant.timezone);
    return {
      ...tenant,
      month,
      start: new Date(range.from),
      end: new Date(range.to),
    };
  }

  /** 下一個要關的月份(依序;還沒結束 = null)。 */
  private async closableMonthOf(
    period: Period & { firstMonth: string },
  ): Promise<string | null> {
    const [last] = await this.closes.findMany(
      period.reader,
      {},
      { sort: { periodEnd: -1 }, limit: 1, select: "month" },
    );
    return nextClosableMonth({
      lastClosed: last?.month ?? null,
      firstMonth: period.firstMonth,
      now: this.clock.now().getTime(),
      timezone: period.timezone,
    });
  }

  /** 那個月(含更早)開班、還沒送出交班結帳的班。 */
  private async openShiftsOf(
    period: Period,
  ): Promise<LotteryPeriodOpenShiftModel[]> {
    const rows: ShiftRow[] = await this.shifts.findMany(
      period.reader,
      { openedAt: { $lt: period.end }, closedAt: null },
      { select: SHIFT_SELECT, sort: { openedAt: 1 } },
    );
    const orgNames = await this.orgNamesOf(
      period.reader,
      rows.map((row) => row.orgId),
    );
    return rows.map((row) => ({
      shiftId: String(row._id),
      orgName: orgNames.get(String(row.orgId)) ?? "",
      label: row.label,
    }));
  }

  /** 擋下關帳的單據(審核中 / 已退回待更正,時間落在那個月;規格 10.4 的表),依判斷時間排序。 */
  private async pendingDocumentsOf(
    period: Period,
  ): Promise<LotteryPeriodPendingDocumentModel[]> {
    const found = [
      ...(await this.pendingFormsOf(period)),
      ...(await this.pendingCheckoutsOf(period)),
    ];
    const serials = await this.serialsOf(
      period.reader,
      found
        .filter((row) => row.serialNo === null)
        .map((row) => new Types.ObjectId(row.submissionId)),
    );
    const orgNames = await this.orgNamesOf(
      period.reader,
      found.map((row) => row.orgId),
    );
    return found
      .toSorted((a, b) => a.at.getTime() - b.at.getTime())
      .map(({ orgId, ...row }) => ({
        ...row,
        serialNo: row.serialNo ?? serials.get(row.submissionId) ?? null,
        orgName: orgNames.get(String(orgId)) ?? "",
      }));
  }

  /**
   * 撤銷售出申請(退款 = 是:退款班次的開班時間)、現金更正單(位置是某一班:那一班的開班時間;
   * 小金庫:申請的送出時間,不新增欄位)。
   */
  private async pendingFormsOf(period: Period): Promise<PendingFound[]> {
    const forms = await this.submissions.findMany(
      period.reader,
      {
        moduleKey: STORE_KEY,
        formKey: { $in: [SALE_REVERSAL_FORM_KEY, CASH_CORRECTION_FORM_KEY] },
        status: { $in: [...UNFINISHED_SUBMISSION_STATUSES] },
      },
      { select: "orgId formKey values serialNo submittedAt" },
    );
    const choices = forms.map((row) => ({ row, ...placeOf(row) }));
    const shifts = await this.shiftsById(
      period.reader,
      choices.flatMap((choice) =>
        choice.shiftId === null ? [] : [choice.shiftId],
      ),
    );
    return choices.flatMap(({ row, kind, shiftId, isVault }) => {
      const shift = shiftId === null ? undefined : shifts.get(String(shiftId));
      const at = shift?.openedAt ?? (isVault ? row.submittedAt : null);
      if (at === null || !inPeriod(period, at)) {
        return [];
      }
      return [
        {
          kind,
          submissionId: String(row._id),
          serialNo: row.serialNo,
          at,
          orgId: row.orgId,
          shiftLabel: shift?.label ?? null,
        },
      ];
    });
  }

  /** 結帳確認申請:交班 = 那一班(開班至送出交班結帳)與該月重疊;日結 = 涵蓋計算期間與該月重疊。 */
  private async pendingCheckoutsOf(period: Period): Promise<PendingFound[]> {
    const checkouts = await this.checkouts.findMany(
      period.reader,
      { status: { $in: UNFINISHED_CHECKOUT_STATUSES } },
      {
        select:
          "orgId type shiftId submittedAt coveredFrom coveredTo submissionId",
      },
    );
    const shifts = await this.shiftsById(
      period.reader,
      checkouts.flatMap((row) => (row.shiftId === null ? [] : [row.shiftId])),
    );
    return checkouts.flatMap((row): PendingFound[] => {
      const isDaily = row.type === CHECKOUT_TYPE.daily;
      const shift =
        row.shiftId === null ? undefined : shifts.get(String(row.shiftId));
      // 日結:上一次日結送出(第一次 = 從頭)至 這次送出;交班:開班至送出交班結帳
      const from = isDaily
        ? row.coveredFrom
        : (shift?.openedAt ?? row.submittedAt);
      const to = isDaily
        ? (row.coveredTo ?? row.submittedAt)
        : (shift?.closedAt ?? row.submittedAt);
      const overlaps =
        (from === null || from < period.end) && to >= period.start;
      if (!overlaps) {
        return [];
      }
      return [
        {
          kind: isDaily ? "daily_close" : "shift_checkout",
          submissionId: String(row.submissionId),
          serialNo: null,
          at: isDaily ? to : (from ?? to),
          orgId: row.orgId,
          shiftLabel: shift?.label ?? null,
        },
      ];
    });
  }

  /**
   * 快照:每個帳戶月底餘額;每家分店(有收銀點的組織)月底小金庫、各收銀點抽屜、那個月沒被日結涵蓋計算的班。
   */
  private async snapshotOf(period: Period): Promise<PeriodCloseSnapshot> {
    const [bankAccounts, stores] = await Promise.all([
      this.bankBalancesOf(period),
      this.storesOf(period),
    ]);
    return { bankAccounts, stores };
  }

  /** 每個帳戶月底餘額 = 期初(期初日期在月底前)+ 月底前交易的收 − 支(`BankTransactionsService.balancesOf`)。 */
  private async bankBalancesOf(
    period: Period,
  ): Promise<PeriodCloseSnapshot["bankAccounts"]> {
    const accounts = await this.accounts.findMany(
      period.reader,
      { openingDate: { $lt: period.end } },
      { select: "label openingBalance tenantId", sort: { createdAt: 1 } },
    );
    const sums = await this.bankTransactions.balancesOf(
      period.reader,
      accounts,
      period.end,
    );
    return accounts.map((account) => ({
      accountId: account._id,
      label: account.label,
      balance:
        account.openingBalance + (sums.get(String(account._id))?.sum ?? 0),
    }));
  }

  private async storesOf(period: Period): Promise<PeriodCloseStoreSnapshot[]> {
    const points = await this.cashPoints.findMany(
      period.reader,
      {},
      { select: "orgId name order", sort: { order: 1, _id: 1 } },
    );
    const storeIds = [
      ...new Map(
        points.map((point) => [String(point.orgId), point.orgId]),
      ).values(),
    ];
    if (storeIds.length === 0) {
      return [];
    }
    const [names, uncovered, drawers] = await Promise.all([
      this.orgNamesOf(period.reader, storeIds),
      this.uncoveredShiftsOf(period),
      this.drawersOf(period, points),
    ]);
    // 各店月底小金庫一次算(TX-07)
    const vaults = await this.ledger.vaultExpectedMany(
      period.reader,
      period.tenantId,
      storeIds,
      period.end,
    );
    const stores = storeIds.map((orgId) => ({
      orgId,
      name: names.get(String(orgId)) ?? "",
      vault: vaults.get(String(orgId))?.amount ?? 0,
      drawers: drawers.get(String(orgId)) ?? [],
      uncoveredShifts: uncovered.get(String(orgId)) ?? [],
    }));
    return stores.toSorted((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }

  /**
   * 每個收銀點月底抽屜的錢:月底前開的最後一班已在月底前送出交班結帳 → 它留給下一班的金額;
   * 月底還開著(跨月的班)→ 金額 null、記那一班的名稱;從沒開過班 → 0。
   */
  private async drawersOf(
    period: Period,
    points: readonly {
      _id: Types.ObjectId;
      orgId: Types.ObjectId;
      name: string;
    }[],
  ): Promise<Map<string, PeriodCloseStoreSnapshot["drawers"]>> {
    const result = new Map<string, PeriodCloseStoreSnapshot["drawers"]>();
    if (points.length === 0) {
      return result;
    }
    // 每個收銀點期末以前開的最後一班:一次 aggregate 依收銀點取第一筆(索引 `(cashPointId, openedAt)`;TX-07)
    const lastRows = await this.shifts.aggregate(period.reader, [
      {
        $match: {
          cashPointId: { $in: points.map((point) => point._id) },
          openedAt: { $lt: period.end },
        },
      },
      { $sort: { cashPointId: 1, openedAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$cashPointId",
          label: { $first: "$label" },
          closedAt: { $first: "$closedAt" },
          checkoutId: { $first: "$checkoutId" },
        },
      },
    ]);
    const lastOf = new Map(
      lastRows.map((row) => [
        String(row._id),
        row as {
          label: string;
          closedAt: Date | null;
          checkoutId: Types.ObjectId | null;
        },
      ]),
    );
    const closedBefore = [...lastOf.values()].filter(
      (last) => last.closedAt !== null && last.closedAt < period.end,
    );
    const checkoutIds = closedBefore.flatMap((last) =>
      last.checkoutId === null ? [] : [last.checkoutId],
    );
    const checkouts =
      checkoutIds.length === 0
        ? []
        : await this.checkouts.findMany(
            period.reader,
            { _id: { $in: checkoutIds } },
            { select: "leftForNext" },
          );
    const leftOf = new Map(
      checkouts.map((checkout) => [String(checkout._id), checkout.leftForNext]),
    );
    for (const point of points) {
      const last = lastOf.get(String(point._id));
      let amount: number | null = 0;
      let spanningShiftLabel: string | null = null;
      if (last !== undefined) {
        if (last.closedAt === null || last.closedAt >= period.end) {
          amount = null;
          spanningShiftLabel = last.label;
        } else if (last.checkoutId !== null) {
          amount = leftOf.get(String(last.checkoutId)) ?? 0;
        }
      }
      const list = result.get(String(point.orgId)) ?? [];
      list.push({
        cashPointId: point._id,
        name: point.name,
        amount,
        spanningShiftLabel,
      });
      result.set(String(point.orgId), list);
    }
    return result;
  }

  /** 那個月開的班沒有被日結涵蓋計算的(判斷在 `DailyCloseLedger`,與店面同一個定義),依分店分組。 */
  private async uncoveredShiftsOf(
    period: Period,
  ): Promise<Map<string, PeriodCloseStoreSnapshot["uncoveredShifts"]>> {
    const shifts = await this.dailyLedger.uncoveredShiftsOpenedIn(
      period.reader,
      period.start,
      period.end,
    );
    const result = new Map<
      string,
      PeriodCloseStoreSnapshot["uncoveredShifts"]
    >();
    for (const shift of shifts) {
      const list = result.get(String(shift.orgId)) ?? [];
      list.push({ shiftId: shift._id, label: shift.label });
      result.set(String(shift.orgId), list);
    }
    return result;
  }

  private async shiftsById(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, ShiftRow>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows: ShiftRow[] = await this.shifts.findMany(
      reader,
      { _id: { $in: [...ids] } },
      { select: SHIFT_SELECT, session },
    );
    return new Map(rows.map((row) => [String(row._id), row]));
  }

  private async serialsOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string | null>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.submissions.findMany(
      reader,
      { _id: { $in: [...ids] } },
      { select: "serialNo" },
    );
    return new Map(rows.map((row) => [String(row._id), row.serialNo]));
  }

  private async orgNamesOf(
    reader: OperatorContext,
    ids: readonly Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.orgs.findMany(
      reader,
      {
        _id: { $in: [...new Map(ids.map((id) => [String(id), id])).values()] },
      },
      { select: "name" },
    );
    return new Map(rows.map((row) => [String(row._id), row.name]));
  }

  private async modelOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    row: {
      _id: Types.ObjectId;
      month: string;
      closedAt: Date;
      closedBy: Types.ObjectId;
      note: string | null;
      snapshot: PeriodCloseSnapshot;
    },
  ): Promise<LotteryPeriodCloseModel> {
    const names = await this.views.userNames(operator, tenantId, [
      row.closedBy,
    ]);
    return {
      id: String(row._id),
      month: row.month,
      closedAt: row.closedAt,
      closedBy: {
        id: String(row.closedBy),
        name: names.get(String(row.closedBy)) ?? "",
      },
      note: row.note,
      snapshot: snapshotModelOf(row.snapshot),
    };
  }
}

function alreadyClosed() {
  return validationError(
    "period already closed",
    ["month"],
    ACCOUNTS_REASONS.alreadyClosed,
  );
}

function snapshotModelOf(
  snapshot: PeriodCloseSnapshot,
): LotteryPeriodSnapshotModel {
  return {
    bankAccounts: snapshot.bankAccounts.map((account) => ({
      accountId: String(account.accountId),
      label: account.label,
      balance: account.balance,
    })),
    stores: snapshot.stores.map((store) => ({
      orgId: String(store.orgId),
      name: store.name,
      vault: store.vault,
      drawerTotal: store.drawers.reduce(
        (sum, drawer) => sum + (drawer.amount ?? 0),
        0,
      ),
      drawers: store.drawers.map((drawer) => ({
        cashPointId: String(drawer.cashPointId),
        name: drawer.name,
        amount: drawer.amount,
        spanningShiftLabel: drawer.spanningShiftLabel,
      })),
      uncoveredShifts: store.uncoveredShifts.map((shift) => ({
        shiftId: String(shift.shiftId),
        label: shift.label,
      })),
    })),
  };
}
