import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { compareDisplayName } from "@repo/domain/collation";
import {
  CHECKOUT_STATUS,
  CHECKOUT_TYPE,
  REDEMPTION_STATUS,
  STOCKTAKE_STATUS,
  TICKET_EVENT_TYPE,
  type TicketEventType,
} from "@repo/domain/project/lottery";
import { CASH_MOVEMENT_TYPE } from "@repo/domain/project/lottery-accounts";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { FieldOptionsService } from "../../../fields/field-options.service";
import {
  LotteryBankAccountsRepository,
  LotteryBankTransactionsRepository,
  LotteryCashMovementsRepository,
} from "../../database/lottery-accounts/lottery-accounts.repositories";
import { LotteryCheckoutsRepository } from "../../database/lottery-checkouts/lottery-checkouts.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { BankTransactionsService } from "../accounts/bank-transactions.service";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { SettlementLedger } from "../settlement/settlement-ledger";
import type { LotteryOperationsReportInput } from "./dto/reports.input";
import type {
  LotteryOperationsBankAccountModel,
  LotteryOperationsCashModel,
  LotteryOperationsCashMovementModel,
  LotteryOperationsGameSalesModel,
  LotteryOperationsNotesModel,
  LotteryOperationsOutstandingModel,
  LotteryOperationsRedemptionModel,
  LotteryOperationsReportModel,
  LotteryOperationsSalesModel,
  LotteryOperationsStoreModel,
  LotteryReportPeriodsModel,
  LotteryReportQtyModel,
} from "./models/operations-report.model";
import {
  INVENTORY_EVENT_TYPES,
  OperationsInventory,
} from "./operations-inventory";
import {
  PostCloseCorrections,
  postCloseByCategory,
} from "./post-close-corrections";
import {
  ReportPeriods,
  type StorePeriod,
  isPriorPeriodOf,
  openMonthsOf,
} from "./report-periods";
import {
  OPERATIONS_RANGE,
  type ReportScope,
  ReportScopes,
} from "./report-scope";
import type { StateSnapshot } from "./report-stock";

/** 營運報表讀的張數事件類型(銷售 + 區塊 4 的進貨、作廢、報廢、待查、遺失、尋回、跳號)。 */
const REPORT_EVENT_TYPES: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
  TICKET_EVENT_TYPE.saleUndo,
  ...INVENTORY_EVENT_TYPES,
];

const SOLD_TYPE_LIST: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
];
const SOLD_TYPES: ReadonlySet<string> = new Set(SOLD_TYPE_LIST);

/** 5b 現金移動的順序(現金更正的增加 / 減少合成一類)。 */
const MOVEMENT_ROWS: readonly { type: string; sources: readonly string[] }[] = [
  { type: "deposit", sources: [CASH_MOVEMENT_TYPE.deposit] },
  { type: "withdraw", sources: [CASH_MOVEMENT_TYPE.withdraw] },
  { type: "bank_deposit", sources: [CASH_MOVEMENT_TYPE.bankDeposit] },
  { type: "refund", sources: [CASH_MOVEMENT_TYPE.refund] },
  { type: "transfer_out", sources: [CASH_MOVEMENT_TYPE.transferOut] },
  { type: "transfer_in", sources: [CASH_MOVEMENT_TYPE.transferIn] },
  {
    type: "correction",
    sources: [
      CASH_MOVEMENT_TYPE.correctionIncrease,
      CASH_MOVEMENT_TYPE.correctionDecrease,
    ],
  },
];

/** 區塊 7 的說明最多列幾張單號、幾個班名。 */
const MAX_LISTED = 5;

/** 同時算幾家店。 */
const STORE_CONCURRENCY = 5;

/**
 * 待結清的「單據種類|待結清種類|哪一邊」→ 區塊 7 的一種(固定順序)。調貨單:收貨店(付款方)多付 = 調貨待退、
 * 出貨店(收款方)多收 = 調貨該退。
 */
const OUTSTANDING_KINDS: readonly { kind: string; key: string }[] = [
  { kind: "purchaseToPay", key: "purchase|to_pay|payer" },
  { kind: "purchaseToRefund", key: "purchase|to_refund|payer" },
  { kind: "transferToReceive", key: "transfer|to_receive|payee" },
  { kind: "transferToPay", key: "transfer|to_pay|payer" },
  { kind: "transferPayerRefund", key: "transfer|to_refund|payer" },
  { kind: "transferPayeeRefund", key: "transfer|to_refund|payee" },
];

interface EventRow {
  _id: Types.ObjectId;
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  gameId: Types.ObjectId;
  type: string;
  amount: number;
  /** 事件前的單張成本快照;舊資料沒有時補上現況的單張成本 */
  cost: number;
  reasonKey: string | null;
  refId: Types.ObjectId | null;
  from: StateSnapshot | null;
  to: StateSnapshot;
  at: Date;
}

const qty = (count = 0, amount = 0): LotteryReportQtyModel => ({
  count,
  amount,
});

const add = (target: LotteryReportQtyModel, amount: number, count = 1) => {
  target.count += count;
  target.amount += amount;
};

const idsOf = (values: readonly Types.ObjectId[]): Types.ObjectId[] => [
  ...new Map(values.map((id) => [String(id), id])).values(),
];

/**
 * 營運報表(專案規格 11.2;正本 `docs/modules/project/reports.md`「營運報表」)。8 個區塊逐店算,
 * 資料一律從紀錄讀(張數事件、現金流水、銀行交易、兌獎、盤點、結帳單、調貨點收、關帳),不另存彙總;
 * 「全部分店合計」由 admin 的工作表加總。沒有 `reports.show-cost` 時成本與毛利相關欄位回 null。
 *
 * **每個數字以「期間結束那一刻」的事實為準**(使用者 10/26 定案:重跑舊報表數字不變):兌獎狀態看期末時、
 * 成本用事件當時的成本快照、結帳單只算期末時有效的、日結涵蓋只算期末以前送出的;之後的變化算在發生當期,
 * 指向已關帳月份的另列「前期更正」。
 */
@Injectable()
export class OperationsReportService {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly periods: ReportPeriods,
    private readonly postClose: PostCloseCorrections,
    private readonly events: LotteryTicketEventsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly inventory: OperationsInventory,
    private readonly movements: LotteryCashMovementsRepository,
    private readonly checkouts: LotteryCheckoutsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly bankAccounts: LotteryBankAccountsRepository,
    private readonly bankTransactions: LotteryBankTransactionsRepository,
    private readonly bankBalances: BankTransactionsService,
    private readonly settlement: SettlementLedger,
    private readonly fieldOptions: FieldOptionsService,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 條件畫面:各店實際期間(對齊日結)與已關帳到哪。 */
  async periodsOf(
    operator: OperatorContext,
    input: LotteryOperationsReportInput,
  ): Promise<LotteryReportPeriodsModel> {
    const scope = await this.scopes.scopeOf(operator, input, OPERATIONS_RANGE);
    const periods = await this.periods.storePeriodsOf(scope, alignOf(input));
    return {
      closedThrough: scope.lastClosed?.month ?? null,
      stores: periods.map((period) => periodModelOf(period)),
    };
  }

  async report(
    operator: OperatorContext,
    input: LotteryOperationsReportInput,
  ): Promise<LotteryOperationsReportModel> {
    const scope = await this.scopes.scopeOf(operator, input, OPERATIONS_RANGE);
    const [periods, closedAt, manualReasons] = await Promise.all([
      this.periods.storePeriodsOf(scope, alignOf(input)),
      this.periods.closedAtByMonth(scope),
      this.reasonLabels(operator),
    ]);
    const outstanding = await this.outstandingOf(operator, periods);
    // 分店之間互不相依:一次最多 5 家平行算(分店上限 50 家,不一次打滿資料庫)
    const stores: LotteryOperationsStoreModel[] = [];
    for (let start = 0; start < periods.length; start += STORE_CONCURRENCY) {
      stores.push(
        ...(await Promise.all(
          periods.slice(start, start + STORE_CONCURRENCY).map((period) =>
            this.storeOf(scope, period, {
              closedAt,
              manualReasons,
              outstanding: outstanding(period),
              operator,
            }),
          ),
        )),
      );
    }
    return {
      closedThrough: scope.lastClosed?.month ?? null,
      canShowCost: scope.canShowCost,
      stores: scope.canShowCost
        ? stores
        : stores.map((store) => withoutCost(store)),
    };
  }

  private async storeOf(
    scope: ReportScope,
    period: StorePeriod,
    shared: {
      closedAt: ReadonlyMap<string, Date>;
      manualReasons: ReadonlyMap<string, string>;
      outstanding: LotteryOperationsOutstandingModel;
      operator: OperatorContext;
    },
  ): Promise<LotteryOperationsStoreModel> {
    const { reader } = scope;
    const { orgId, from, to } = period;
    const events = await this.eventsOf(reader, {
      $or: [{ orgId }, { "from.orgId": orgId }],
      at: { $gte: from, $lt: to },
      type: { $in: [...REPORT_EVENT_TYPES] },
    });
    // 這家店的事件(事件後在這家店);「事件前在這家店」的(例:別家店替它尋回)只給區塊 4 判斷
    const own = events.filter((event) => event.to.orgId.equals(orgId));
    const sales = await this.salesOf(reader, own, shared.manualReasons);
    const [inventory, redemption, cashAndNotes, bankAccounts] =
      await Promise.all([
        this.inventory.inventoryOf(reader, period, events, {
          tickets: sales.net.count,
          cost: sales.cost ?? 0,
        }),
        this.redemptionOf(reader, period),
        this.cashAndNotesOf(scope, period, own, shared.closedAt),
        this.bankOf(shared.operator, scope, period),
      ]);
    return {
      orgId: String(orgId),
      period: periodModelOf(period),
      sales,
      redemption,
      inventory,
      cash: cashAndNotes.cash,
      bankAccounts,
      outstanding: shared.outstanding,
      notes: cashAndNotes.notes,
    };
  }

  /** 讀事件;沒有成本快照的舊資料補上張現況的單張成本(一次查)。 */
  private async eventsOf(
    reader: OperatorContext,
    filter: Record<string, unknown>,
  ): Promise<EventRow[]> {
    const rows = (await this.events.findMany(reader, filter, {
      select:
        "ticketId bookId gameId type amount cost reasonKey refId from to at",
      sort: { at: 1, _id: 1 },
    })) as unknown as (Omit<EventRow, "cost"> & { cost: number | null })[];
    const missing = rows
      .filter((row) => row.cost === null)
      .map((row) => row.ticketId);
    const current = await this.unitCostsOf(reader, missing);
    // 讀出來的是 mongoose 文件(展開會掉欄位):逐欄抄成純物件
    return rows.map((row) => ({
      _id: row._id,
      ticketId: row.ticketId,
      bookId: row.bookId,
      gameId: row.gameId,
      type: row.type,
      amount: row.amount,
      cost: row.cost ?? current.get(String(row.ticketId)) ?? 0,
      reasonKey: row.reasonKey,
      refId: row.refId,
      from: row.from,
      to: row.to,
      at: row.at,
    }));
  }

  // ---- 區塊 1、2:銷售、毛利 ----

  private async salesOf(
    reader: OperatorContext,
    events: readonly EventRow[],
    reasonLabels: ReadonlyMap<string, string>,
  ): Promise<LotteryOperationsSalesModel> {
    const scan = qty();
    const stocktake = qty();
    const undo = qty();
    const manual = new Map<string, LotteryReportQtyModel>();
    const byGame = new Map<
      string,
      {
        gameId: Types.ObjectId;
        sold: number;
        undone: number;
        net: number;
        cost: number;
      }
    >();
    let cost = 0;
    for (const event of events) {
      const sold = SOLD_TYPES.has(event.type);
      const undone = event.type === TICKET_EVENT_TYPE.saleUndo;
      if (!sold && !undone) {
        continue;
      }
      // 已售成本:售出當下記下的單張成本;撤銷扣回那張撤銷當下的成本(之後調走、成本變了不影響)
      const ticketCost = event.cost;
      const game = byGame.get(String(event.gameId)) ?? {
        gameId: event.gameId,
        sold: 0,
        undone: 0,
        net: 0,
        cost: 0,
      };
      if (undone) {
        add(undo, event.amount);
        game.undone += 1;
        game.net -= event.amount;
        game.cost -= ticketCost;
        cost -= ticketCost;
      } else {
        if (event.type === TICKET_EVENT_TYPE.saleStocktake) {
          add(stocktake, event.amount);
        } else if (event.reasonKey === null) {
          add(scan, event.amount);
        } else {
          const row = manual.get(event.reasonKey) ?? qty();
          add(row, event.amount);
          manual.set(event.reasonKey, row);
        }
        game.sold += 1;
        game.net += event.amount;
        game.cost += ticketCost;
        cost += ticketCost;
      }
      byGame.set(String(event.gameId), game);
    }
    const manualTotal = [...manual.values()].reduce(
      (sum, row) => qty(sum.count + row.count, sum.amount + row.amount),
      qty(),
    );
    const gameRows =
      byGame.size === 0
        ? []
        : await this.games.findMany(
            reader,
            { _id: { $in: [...byGame.values()].map((row) => row.gameId) } },
            { select: "gameCode name unitPrice" },
          );
    const gameById = new Map(gameRows.map((row) => [String(row._id), row]));
    const games: LotteryOperationsGameSalesModel[] = [...byGame.entries()]
      .map(([id, row]) => {
        const game = gameById.get(id);
        return {
          gameId: id,
          gameCode: game?.gameCode ?? "",
          gameName: game?.name ?? "",
          unitPrice: game?.unitPrice ?? 0,
          sold: row.sold,
          undone: row.undone,
          netAmount: row.net,
          cost: row.cost,
        };
      })
      .toSorted((a, b) => a.gameCode.localeCompare(b.gameCode, "zh-Hant"));
    return {
      scan,
      manual: [...manual.entries()]
        .map(([reasonKey, row]) => ({
          reasonKey,
          reason: reasonLabels.get(reasonKey) ?? reasonKey,
          count: row.count,
          amount: row.amount,
        }))
        .toSorted((a, b) => compareDisplayName(a.reason, b.reason)),
      stocktake,
      undo,
      net: qty(
        scan.count + manualTotal.count + stocktake.count - undo.count,
        scan.amount + manualTotal.amount + stocktake.amount - undo.amount,
      ),
      cost,
      games,
    };
  }

  // ---- 區塊 3:兌獎 ----

  /**
   * 期間內登記的兌獎,狀態看**期末那一刻**:期末前撤銷(`revokedAt` < 迄)= 已撤銷;其他 = 有效,
   * 其中期末前已送兌(`sentAt` < 迄)= 已送兌,其餘 = 店內持有。期末之後才撤銷 / 送兌的,算在那天。
   */
  private async redemptionOf(
    reader: OperatorContext,
    period: StorePeriod,
  ): Promise<LotteryOperationsRedemptionModel> {
    const rows = await this.redemptions.findMany(
      reader,
      {
        orgId: period.orgId,
        redeemedAt: { $gte: period.from, $lt: period.to },
      },
      { select: "prizeAmount status sentAt revokedAt sentHistory" },
    );
    const result = {
      valid: qty(),
      inStore: qty(),
      sent: qty(),
      revoked: qty(),
    };
    const before = (at: Date | null) => at !== null && at < period.to;
    for (const row of rows) {
      if (row.status === REDEMPTION_STATUS.revoked && before(row.revokedAt)) {
        add(result.revoked, row.prizeAmount);
        continue;
      }
      add(result.valid, row.prizeAmount);
      add(
        isSentAt(row, period.to) ? result.sent : result.inStore,
        row.prizeAmount,
      );
    }
    return result;
  }

  // ---- 區塊 5、8:現金、註記 ----

  private async cashAndNotesOf(
    scope: ReportScope,
    period: StorePeriod,
    events: readonly EventRow[],
    closedAt: ReadonlyMap<string, Date>,
  ): Promise<{
    cash: LotteryOperationsCashModel;
    notes: LotteryOperationsNotesModel;
  }> {
    const { reader } = scope;
    const { orgId, from, to } = period;
    const [movements, submitted, submittedStocktakes] = await Promise.all([
      this.movements.findMany(
        reader,
        { orgId, occurredAt: { $gte: from, $lt: to } },
        {
          select:
            "type from to amount postCloseOf attributedShiftId occurredAt",
        },
      ),
      // 依第一次送出的時間歸期間(退回後再送出不改寫;舊資料沒有就用送出時間)
      this.checkouts.findMany(
        reader,
        {
          orgId,
          $or: [
            { firstSubmittedAt: { $gte: from, $lt: to } },
            { firstSubmittedAt: null, submittedAt: { $gte: from, $lt: to } },
          ],
        },
        { select: CHECKOUT_SELECT },
      ),
      // 依第一次送出的時間歸期間(退回後再送出不改寫;舊資料沒有就用送出時間)
      this.stocktakes.findMany(
        reader,
        {
          orgId,
          $or: [
            { firstSubmittedAt: { $gte: from, $lt: to } },
            { firstSubmittedAt: null, submittedAt: { $gte: from, $lt: to } },
          ],
        },
        { select: "status submittedAt closedAt summary attempts" },
      ),
    ]);
    // 盤點單期末那一刻有效的那一次送出的未盤本數(期末前已退回 / 駁回、還沒重送的不算)
    const uncounted = submittedStocktakes.flatMap((row) => {
      const count = uncountedAt(row, to);
      return count > 0 ? [count] : [];
    });
    // 期末那一刻有效的那一次送出:待審核或已核准;期末前已退回、還沒重送的不算
    const checkouts = submitted.flatMap((row) => {
      const attempt = attemptAt(row, to);
      return attempt === null ? [] : [{ row, attempt }];
    });
    const shiftCheckouts = checkouts.filter(
      ({ row }) => row.type === CHECKOUT_TYPE.shift && row.shiftId !== null,
    );
    const dailies = checkouts.filter(
      ({ row }) => row.type === CHECKOUT_TYPE.daily,
    );
    const shiftIds = shiftCheckouts.flatMap(({ row }) =>
      row.shiftId === null ? [] : [row.shiftId],
    );
    const [recordedRows, covering] = await Promise.all([
      this.postClose.rowsOf(reader, { orgId, from, to }),
      shiftIds.length === 0
        ? Promise.resolve([])
        : this.checkouts.findMany(
            reader,
            {
              orgId,
              type: CHECKOUT_TYPE.daily,
              $or: [
                { coveredShiftIds: { $in: shiftIds } },
                { "attempts.coveredShiftIds": { $in: shiftIds } },
              ],
            },
            { select: CHECKOUT_SELECT },
          ),
    ]);
    const shiftInfo = await this.shiftInfoOf(reader, [
      ...shiftIds,
      ...recordedRows.map((row) => row.shiftId),
      ...movements.flatMap((row) =>
        row.attributedShiftId === null ? [] : [row.attributedShiftId],
      ),
    ]);
    const isPrior = (shiftId: string, recordedAt: Date) => {
      const openedAt = shiftInfo.get(shiftId)?.openedAt;
      return (
        openedAt !== undefined &&
        isPriorPeriodOf(scope, closedAt, openedAt, recordedAt)
      );
    };
    // 事後更正算在**記錄當期**(使用者 10/12 定案):這家店這段期間記的,依原因類別彙總;
    // 指向已關帳月份的照算,另在「前期更正」標出(與撤銷售出 / 銀行沖正一致)
    const prior: { amount: number }[] = recordedRows.filter((row) =>
      isPrior(row.shiftId, row.recordedAt),
    );
    // 現金更正的歸屬班次指向已關帳月份(不是事後更正的那幾筆,事後更正已在上面)
    for (const row of movements) {
      if (
        row.attributedShiftId !== null &&
        row.postCloseOf === null &&
        isPrior(String(row.attributedShiftId), row.occurredAt)
      ) {
        prior.push({ amount: signedCorrection(row) });
      }
    }
    prior.push(
      ...(await this.priorSaleUndos(scope, events, closedAt)),
      ...(await this.priorBankReversals(scope, period, closedAt)),
    );

    // 期末那一刻已送出、有效的那一次日結涵蓋的班(之後才日結的,重跑舊報表仍是沒被涵蓋)
    const covered = new Set(
      covering.flatMap(
        (row) =>
          attemptAt(row as unknown as CheckoutRow, to)?.coveredShiftIds.map(
            String,
          ) ?? [],
      ),
    );
    const uncovered = shiftIds.filter((id) => !covered.has(String(id)));
    const skipped = new Map<string, number>();
    for (const { attempt } of checkouts) {
      if (attempt.stocktakeMode === "skip") {
        const reason = attempt.skipReason ?? "";
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      }
    }
    return {
      cash: {
        shiftCount: shiftCheckouts.length,
        pendingShiftCount: shiftCheckouts.filter(
          ({ row }) => !(row.confirmedAt !== null && row.confirmedAt < to),
        ).length,
        shiftDifference: shiftCheckouts.reduce(
          (sum, { attempt }) => sum + attempt.difference,
          0,
        ),
        postClose: postCloseByCategory(recordedRows),
        dailyCloseCount: dailies.length,
        vaultDifference: dailies.reduce(
          (sum, { attempt }) => sum + attempt.difference,
          0,
        ),
        movements: movementsOf(movements),
      },
      notes: {
        skippedStocktakes: [...skipped.entries()]
          .map(([reason, count]) => ({ reason, count }))
          .toSorted((a, b) => b.count - a.count),
        uncountedStocktakes: uncounted.length,
        uncountedBooks: uncounted.reduce((sum, count) => sum + count, 0),
        uncoveredShifts: uncovered.length,
        uncoveredShiftLabels: uncovered
          .slice(0, MAX_LISTED)
          .map((id) => shiftInfo.get(String(id))?.label ?? ""),
        priorPeriodCount: prior.length,
        priorPeriodAmount: prior.reduce((sum, row) => sum + row.amount, 0),
        openMonths: openMonthsOf(scope, from, to),
      },
    };
  }

  /** 撤銷的原售出在已關帳月份、撤銷記在那個月關帳之後 → 前期更正(−撤銷金額)。 */
  private async priorSaleUndos(
    scope: ReportScope,
    events: readonly EventRow[],
    closedAt: ReadonlyMap<string, Date>,
  ): Promise<{ amount: number }[]> {
    const undos = events.filter(
      (event) => event.type === TICKET_EVENT_TYPE.saleUndo,
    );
    if (undos.length === 0 || scope.lastClosed === null) {
      return [];
    }
    const sales = await this.events.findMany(
      scope.reader,
      {
        ticketId: { $in: idsOf(undos.map((event) => event.ticketId)) },
        type: { $in: [...SOLD_TYPE_LIST] },
      },
      { select: "ticketId at", sort: { at: 1, _id: 1 } },
    );
    return undos.flatMap((undo) => {
      const original = sales.findLast(
        (sale) => sale.ticketId.equals(undo.ticketId) && sale.at <= undo.at,
      );
      return original !== undefined &&
        isPriorPeriodOf(scope, closedAt, original.at, undo.at)
        ? [{ amount: -undo.amount }]
        : [];
    });
  }

  /** 銀行沖正:原交易在已關帳月份、沖正記在關帳之後 → 前期更正(收 +、支 −)。 */
  private async priorBankReversals(
    scope: ReportScope,
    period: StorePeriod,
    closedAt: ReadonlyMap<string, Date>,
  ): Promise<{ amount: number }[]> {
    if (scope.lastClosed === null) {
      return [];
    }
    const reversals = await this.bankTransactions.findMany(
      scope.reader,
      {
        branchOrgId: period.orgId,
        occurredAt: { $gte: period.from, $lt: period.to },
        reversalOf: { $ne: null },
      },
      { select: "reversalOf direction amount createdAt" },
    );
    if (reversals.length === 0) {
      return [];
    }
    const originals = await this.bankTransactions.findMany(
      scope.reader,
      {
        _id: {
          $in: idsOf(
            reversals.flatMap((row) =>
              row.reversalOf === null ? [] : [row.reversalOf],
            ),
          ),
        },
      },
      { select: "occurredAt" },
    );
    const originalAt = new Map(
      originals.map((row) => [String(row._id), row.occurredAt]),
    );
    return reversals.flatMap((row) => {
      const at = originalAt.get(String(row.reversalOf));
      return at !== undefined &&
        isPriorPeriodOf(scope, closedAt, at, row.createdAt)
        ? [{ amount: row.direction === "in" ? row.amount : -row.amount }]
        : [];
    });
  }

  // ---- 區塊 6:銀行 ----

  /**
   * 這家店使用的帳戶(使用組織包含它,或期間內有歸屬這家店的交易):只算歸屬這家店的交易、同一類型合一列
   * (收、支分開加,沖正算在同一列並計筆數);期末餘額是整個帳戶的(註明共用)。
   */
  private async bankOf(
    operator: OperatorContext,
    scope: ReportScope,
    period: StorePeriod,
  ): Promise<LotteryOperationsBankAccountModel[]> {
    const { reader } = scope;
    const [accounts, transactions, store] = await Promise.all([
      this.bankAccounts.findMany(
        reader,
        {},
        {
          select: "orgId label shareOrgs openingBalance openingDate tenantId",
          sort: { createdAt: 1, _id: 1 },
        },
      ),
      this.bankTransactions.findMany(
        reader,
        {
          branchOrgId: period.orgId,
          occurredAt: { $gte: period.from, $lt: period.to },
        },
        { select: "accountId type direction amount reversalOf" },
      ),
      this.orgs.findById(reader, period.orgId, { select: "ancestors" }),
    ]);
    const chain = new Set([
      String(period.orgId),
      ...(store?.ancestors ?? []).map(String),
    ]);
    const used = accounts.filter(
      (account) =>
        account.orgId.equals(period.orgId) ||
        account.shareOrgs.some(
          (entry) =>
            entry.orgId.equals(period.orgId) ||
            (entry.includeDescendants && chain.has(String(entry.orgId))),
        ) ||
        transactions.some((row) => row.accountId.equals(account._id)),
    );
    const balances = await this.bankBalances.balancesOf(
      operator,
      used,
      period.to,
    );
    return used.map((account) => {
      const totals = new Map<
        string,
        LotteryOperationsBankAccountModel["types"][number]
      >();
      for (const row of transactions) {
        if (!row.accountId.equals(account._id)) {
          continue;
        }
        const entry = totals.get(row.type) ?? {
          type: row.type,
          inAmount: 0,
          outAmount: 0,
          reversalCount: 0,
        };
        if (row.direction === "in") {
          entry.inAmount += row.amount;
        } else {
          entry.outAmount += row.amount;
        }
        if (row.reversalOf !== null) {
          entry.reversalCount += 1;
        }
        totals.set(row.type, entry);
      }
      const opening =
        account.openingDate < period.to ? account.openingBalance : 0;
      return {
        accountId: String(account._id),
        label: account.label,
        shared:
          account.shareOrgs.length > 1 ||
          account.shareOrgs.some((entry) => entry.includeDescendants),
        types: [...totals.values()],
        endingBalance: opening + (balances.get(String(account._id))?.sum ?? 0),
      };
    });
  }

  // ---- 區塊 7:未結清 ----

  /**
   * 期末時的待付 / 待退進貨款、待收 / 待付調貨款、調貨待退 / 該退(`SettlementLedger.outstandingAt`:
   * 單據當時還有效、收付只算期末以前的),依歸屬分店;說明列單號(最多 5 張)。
   * 對齊日結時各店的「迄」不同:所有「迄」一次算(`outstandingAtMany`)。
   */
  private async outstandingOf(
    operator: OperatorContext,
    periods: readonly StorePeriod[],
  ): Promise<(period: StorePeriod) => LotteryOperationsOutstandingModel> {
    const ends = [...new Set(periods.map((period) => period.to.getTime()))];
    // 各店的「迄」一次算(單據、收付各讀一次,在記憶體依各時點挑;TX-07)
    const rowsAt = await this.settlement.outstandingAtMany(
      operator,
      ends.map((end) => new Date(end)),
    );
    const byEnd = new Map(
      ends.map((end, index) => [end, rowsAt[index] ?? []] as const),
    );
    return (period) => {
      const items = OUTSTANDING_KINDS.map(({ kind }) => ({
        kind,
        count: 0,
        amount: 0,
        serialNos: [] as string[],
      }));
      for (const row of byEnd.get(period.to.getTime()) ?? []) {
        const key = `${row.snapshot.registration.kind}|${row.kind}|${row.side.role}`;
        const item =
          items[OUTSTANDING_KINDS.findIndex((entry) => entry.key === key)];
        if (item === undefined || !row.branchOrgId.equals(period.orgId)) {
          continue;
        }
        item.count += 1;
        item.amount += row.amount;
        const serialNo = row.snapshot.submission.serialNo ?? null;
        if (serialNo !== null && item.serialNos.length < MAX_LISTED) {
          item.serialNos.push(serialNo);
        }
      }
      return { items };
    };
  }

  // ---- 共用 ----

  private async unitCostsOf(
    reader: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (ticketIds.length === 0) {
      return new Map();
    }
    const rows = await this.tickets.findMany(
      reader,
      { _id: { $in: idsOf(ticketIds) } },
      { select: "unitCost" },
    );
    return new Map(rows.map((row) => [String(row._id), row.unitCost]));
  }

  /** 班的開班時間(判斷前期更正)與名稱(沒被日結涵蓋的班列名)。 */
  private async shiftInfoOf(
    reader: OperatorContext,
    ids: readonly (Types.ObjectId | string)[],
  ): Promise<Map<string, { openedAt: Date; label: string }>> {
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.shifts.findMany(
      reader,
      { _id: { $in: unique } },
      { select: "openedAt label" },
    );
    return new Map(
      rows.map((row) => [
        String(row._id),
        { openedAt: row.openedAt, label: row.label },
      ]),
    );
  }

  /** 手動標記原因的名稱(欄位管理「手動標記原因」;停用的選項找不到 → 顯示代碼)。 */
  private async reasonLabels(
    operator: OperatorContext,
  ): Promise<Map<string, string>> {
    const options = await this.fieldOptions.optionsOf(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.manualSaleReason,
      LOTTERY_FIELD_CATEGORIES,
    );
    return new Map(options.map((option) => [option.value, option.label]));
  }
}

/**
 * 兌獎在 `at` 那一刻已送兌:送兌歷程裡有一段在 `at` 以前送出、`at` 那一刻還沒回到店內持有;
 * 舊資料沒有歷程 → 現在已送兌而且送兌時間早於 `at`。
 */
function isSentAt(
  row: {
    status: string;
    sentAt: Date | null;
    sentHistory?: { sentAt: Date; releasedAt: Date | null }[];
  },
  at: Date,
): boolean {
  const history = row.sentHistory ?? [];
  if (history.length === 0) {
    return (
      row.status === REDEMPTION_STATUS.sent &&
      row.sentAt !== null &&
      row.sentAt < at
    );
  }
  return history.some(
    (entry) =>
      entry.sentAt < at &&
      (entry.releasedAt === null || entry.releasedAt >= at),
  );
}

interface StocktakeRow {
  status: string;
  submittedAt: Date;
  closedAt?: Date | null;
  summary: { uncountedCount: number };
  attempts?: {
    submittedAt: Date;
    closedAt: Date | null;
    uncountedCount: number;
  }[];
}

/**
 * 盤點單在 `at` 那一刻有效的那一次送出的未盤本數:`at` 以前最後一次送出、那一刻還沒被退回 / 駁回;沒有 = 0。
 * 舊資料沒有送出快照:照現在的欄位(期末前已駁回的不算)。
 */
function uncountedAt(row: StocktakeRow, at: Date): number {
  const attempts = row.attempts ?? [];
  if (attempts.length === 0) {
    const rejected =
      row.status === STOCKTAKE_STATUS.rejected &&
      !(row.closedAt != null && row.closedAt >= at);
    return row.submittedAt >= at || rejected ? 0 : row.summary.uncountedCount;
  }
  const last = attempts.findLast((attempt) => attempt.submittedAt < at);
  return last === undefined || (last.closedAt !== null && last.closedAt < at)
    ? 0
    : last.uncountedCount;
}

/** 結帳單讀的欄位(期末那一刻有效的那一次送出)。 */
const CHECKOUT_SELECT =
  "type status shiftId difference stocktakeMode skipReason skipReasonKey confirmedAt returnedAt submittedAt firstSubmittedAt attempts coveredShiftIds";

interface CheckoutAttemptRow {
  submittedAt: Date;
  returnedAt: Date | null;
  difference: number;
  stocktakeMode: string;
  skipReason: string | null;
  coveredShiftIds: Types.ObjectId[];
}

interface CheckoutRow {
  status: string;
  submittedAt: Date;
  returnedAt?: Date | null;
  difference: number;
  stocktakeMode: string;
  skipReason: string | null;
  skipReasonKey: string | null;
  coveredShiftIds?: Types.ObjectId[];
  attempts?: CheckoutAttemptRow[];
}

/**
 * 結帳單在 `at` 那一刻有效的那一次送出(使用者 10/27 定案:重跑舊報表數字不變):`at` 以前最後一次送出,
 * 而且那一次沒在 `at` 以前被退回(待審核或已核准);沒有 = null。差額、盤點方式、日結涵蓋的班都照那一次。
 * 舊資料沒有送出快照:照現在的欄位(已退回且退回時間早於 `at` → 無效)。
 */
function attemptAt(row: CheckoutRow, at: Date): CheckoutAttemptRow | null {
  const attempts = row.attempts ?? [];
  if (attempts.length === 0) {
    const returned =
      row.status === CHECKOUT_STATUS.returned &&
      !(row.returnedAt != null && row.returnedAt >= at);
    return row.submittedAt >= at || returned
      ? null
      : {
          submittedAt: row.submittedAt,
          returnedAt: row.returnedAt ?? null,
          difference: row.difference,
          stocktakeMode: row.stocktakeMode,
          skipReason: row.skipReason ?? row.skipReasonKey,
          coveredShiftIds: row.coveredShiftIds ?? [],
        };
  }
  const last = attempts.findLast((attempt) => attempt.submittedAt < at);
  if (
    last === undefined ||
    (last.returnedAt !== null && last.returnedAt < at)
  ) {
    return null;
  }
  return last;
}

/**
 * 5b 現金移動:依類型分列,每一筆對抽屜 / 小金庫的影響(流入 +、流出 −);沖正那一筆兩端對調,自然算反向。
 * 事後更正那幾筆(補記到已結帳的班)在 5a,不重複列。
 */
function movementsOf(
  rows: readonly {
    type: string;
    from: string;
    to: string;
    amount: number;
    postCloseOf: unknown;
  }[],
): LotteryOperationsCashMovementModel[] {
  return MOVEMENT_ROWS.map(({ type, sources }) => {
    const result = { type, count: 0, drawer: 0, vault: 0 };
    for (const row of rows) {
      if (row.postCloseOf !== null || !sources.includes(row.type)) {
        continue;
      }
      result.count += 1;
      for (const [place, sign] of [
        [row.from, -1],
        [row.to, 1],
      ] as const) {
        if (place === "drawer") {
          result.drawer += sign * row.amount;
        } else if (place === "vault") {
          result.vault += sign * row.amount;
        }
      }
    }
    return result;
  });
}

const alignOf = (input: LotteryOperationsReportInput): boolean =>
  input.periodKind === "day" && input.alignDailyClose === true;

const periodModelOf = (period: StorePeriod) => ({
  orgId: String(period.orgId),
  from: period.from,
  to: period.to,
  alignment: period.alignment,
});

/** 現金更正對抽屜 / 小金庫的影響:流入 +、流出 −。 */
const signedCorrection = (row: { from: string; to: string; amount: number }) =>
  row.from === "external" ? row.amount : -row.amount;

/**
 * 沒有 `reports.show-cost`:成本與毛利相關欄位、調入 / 調出 / 在途的調貨金額一律 null(api 不送出,
 * 不只是畫面不顯示;調入的調貨金額就是收貨店的成本,使用者 10/26 定案)。直接改這次查詢剛組好的物件(沒有共用)。
 */
function withoutCost(
  store: LotteryOperationsStoreModel,
): LotteryOperationsStoreModel {
  store.sales.cost = null;
  for (const game of store.sales.games) {
    game.cost = null;
  }
  Object.assign(store.inventory, {
    openingCost: null,
    purchaseCost: null,
    transferInAmount: null,
    transferOutCost: null,
    transferOutAmount: null,
    transferGain: null,
    salesCost: null,
    scrapCost: null,
    newInvestigatingCost: null,
    investigateRecoveredCost: null,
    lostRecoveredCost: null,
    pendingAdjustCost: null,
    endingCost: null,
    checkCost: null,
    inTransitAmount: null,
    investigatingCost: null,
    lostCost: null,
  });
  return store;
}
