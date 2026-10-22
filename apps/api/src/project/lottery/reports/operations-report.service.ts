import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  CHECKOUT_TYPE,
  REDEMPTION_STATUS,
  STOCKTAKE_STATUS,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
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
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { LotteryTransferReceiptsRepository } from "../../database/lottery-transfers/lottery-transfer-receipts.repository";
import { BankTransactionsService } from "../accounts/bank-transactions.service";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { SettlementLedger } from "../settlement/settlement-ledger";
import type { LotteryOperationsReportInput } from "./dto/reports.input";
import type {
  LotteryOperationsBankAccountModel,
  LotteryOperationsCashModel,
  LotteryOperationsGameSalesModel,
  LotteryOperationsInventoryModel,
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

/** 營運報表讀的張數事件類型(銷售、進貨、報廢、遺失、尋回、跳號)。 */
const REPORT_EVENT_TYPES: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
  TICKET_EVENT_TYPE.saleUndo,
  TICKET_EVENT_TYPE.purchase,
  TICKET_EVENT_TYPE.purchaseVoid,
  TICKET_EVENT_TYPE.scrap,
  TICKET_EVENT_TYPE.lose,
  TICKET_EVENT_TYPE.recover,
  TICKET_EVENT_TYPE.skip,
  TICKET_EVENT_TYPE.unskip,
];

const SOLD_TYPE_LIST: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
];
const SOLD_TYPES: ReadonlySet<string> = new Set(SOLD_TYPE_LIST);

/** 期末還在店裡的張:庫存、檯面(在途算在途中,不算任何一家店)。 */
const ON_HAND_LOCATIONS: ReadonlySet<string> = new Set([
  TICKET_LOCATION_KIND.stock,
  TICKET_LOCATION_KIND.counter,
]);

/** 現金流水的「正常方向」:沖正的那一筆兩端對調,算負的(規格 10.2)。 */
const NORMAL_ROUTE: Readonly<Record<string, { from?: string; to?: string }>> = {
  [CASH_MOVEMENT_TYPE.deposit]: { to: "vault" },
  [CASH_MOVEMENT_TYPE.bankDeposit]: { to: "bank" },
  [CASH_MOVEMENT_TYPE.transferOut]: { to: "external" },
  [CASH_MOVEMENT_TYPE.transferIn]: { from: "external" },
  [CASH_MOVEMENT_TYPE.refund]: { to: "external" },
};

/** 待結清的「單據種類|待結清種類」→ 區塊 7 的欄位(調貨單收款方的待退不列)。 */
const OUTSTANDING_FIELDS: Readonly<Record<string, string>> = {
  "purchase|to_pay": "purchaseToPay",
  "purchase|to_refund": "purchaseToRefund",
  "transfer|to_receive": "transferToReceive",
  "transfer|to_pay": "transferToPay",
};

interface EventRow {
  _id: Types.ObjectId;
  ticketId: Types.ObjectId;
  bookId: Types.ObjectId;
  gameId: Types.ObjectId;
  type: string;
  amount: number;
  cost: number | null;
  reasonKey: string | null;
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
 */
@Injectable()
export class OperationsReportService {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly periods: ReportPeriods,
    private readonly postClose: PostCloseCorrections,
    private readonly events: LotteryTicketEventsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly games: LotteryGamesRepository,
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly receipts: LotteryTransferReceiptsRepository,
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
    const outstanding = await this.outstandingOf(operator, scope);
    const stores: LotteryOperationsStoreModel[] = [];
    for (const period of periods) {
      stores.push(
        await this.storeOf(scope, period, {
          closedAt,
          manualReasons,
          outstanding: outstanding(period),
          operator,
        }),
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
    const events = (await this.events.findMany(
      reader,
      {
        orgId,
        at: { $gte: from, $lt: to },
        type: { $in: [...REPORT_EVENT_TYPES] },
      },
      {
        select: "ticketId bookId gameId type amount cost reasonKey at",
        sort: { at: 1, _id: 1 },
      },
    )) as unknown as EventRow[];
    const unitCost = await this.unitCostsOf(
      reader,
      events
        .filter(
          (event) =>
            SOLD_TYPES.has(event.type) ||
            event.type === TICKET_EVENT_TYPE.saleUndo ||
            event.type === TICKET_EVENT_TYPE.lose ||
            event.type === TICKET_EVENT_TYPE.recover,
        )
        .map((event) => event.ticketId),
    );
    const [sales, inventory, redemption, cashAndNotes, bankAccounts] =
      await Promise.all([
        this.salesOf(reader, events, unitCost, shared.manualReasons),
        this.inventoryOf(reader, period, events, unitCost),
        this.redemptionOf(reader, period),
        this.cashAndNotesOf(scope, period, events, shared.closedAt),
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

  // ---- 區塊 1、2:銷售、毛利 ----

  private async salesOf(
    reader: OperatorContext,
    events: readonly EventRow[],
    unitCost: ReadonlyMap<string, number>,
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
      const ticketCost = unitCost.get(String(event.ticketId)) ?? 0;
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
    const gameRows = await this.games.findMany(
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
        .toSorted((a, b) => a.reason.localeCompare(b.reason, "zh-Hant")),
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
      { select: "prizeAmount status" },
    );
    const result = {
      valid: qty(),
      inStore: qty(),
      sent: qty(),
      revoked: qty(),
    };
    for (const row of rows) {
      if (row.status === REDEMPTION_STATUS.revoked) {
        add(result.revoked, row.prizeAmount);
        continue;
      }
      add(result.valid, row.prizeAmount);
      add(
        row.status === REDEMPTION_STATUS.sent ? result.sent : result.inStore,
        row.prizeAmount,
      );
    }
    return result;
  }

  // ---- 區塊 4:庫存異動 ----

  private async inventoryOf(
    reader: OperatorContext,
    period: StorePeriod,
    events: readonly EventRow[],
    unitCost: ReadonlyMap<string, number>,
  ): Promise<LotteryOperationsInventoryModel> {
    const { orgId, from, to } = period;
    const count = (type: string) =>
      events.filter((event) => event.type === type).length;
    const costOf = (type: string) =>
      events
        .filter((event) => event.type === type)
        .reduce(
          (sum, event) => sum + (unitCost.get(String(event.ticketId)) ?? 0),
          0,
        );
    const booksOf = (type: string) =>
      idsOf(
        events
          .filter((event) => event.type === type)
          .map((event) => event.bookId),
      );
    const purchased = booksOf(TICKET_EVENT_TYPE.purchase);
    const voided = booksOf(TICKET_EVENT_TYPE.purchaseVoid);
    const [bookRows, incoming, outgoing, ending] = await Promise.all([
      this.books.findMany(
        reader,
        { _id: { $in: [...purchased, ...voided] } },
        { select: "cost" },
      ),
      this.receipts.findMany(
        reader,
        { orgId, receivedAt: { $gte: from, $lt: to } },
        { select: "purchaseAmount tickets" },
      ),
      this.receipts.findMany(
        reader,
        { fromOrgId: orgId, receivedAt: { $gte: from, $lt: to } },
        { select: "purchaseAmount tickets" },
      ),
      this.endingStockOf(reader, orgId, to),
    ]);
    const bookCost = new Map(
      bookRows.map((row) => [String(row._id), row.cost]),
    );
    const sumBooks = (ids: readonly Types.ObjectId[]) =>
      ids.reduce((sum, id) => sum + (bookCost.get(String(id)) ?? 0), 0);
    const outAmount = outgoing.reduce(
      (sum, row) => sum + row.purchaseAmount,
      0,
    );
    const outCost = outgoing.reduce(
      (sum, row) =>
        sum + row.tickets.reduce((inner, ticket) => inner + ticket.unitCost, 0),
      0,
    );
    return {
      purchaseBooks: purchased.length - voided.length,
      purchaseTickets:
        count(TICKET_EVENT_TYPE.purchase) -
        count(TICKET_EVENT_TYPE.purchaseVoid),
      purchaseCost: sumBooks(purchased) - sumBooks(voided),
      transferInTickets: incoming.reduce(
        (sum, row) => sum + row.tickets.length,
        0,
      ),
      transferInAmount: incoming.reduce(
        (sum, row) => sum + row.purchaseAmount,
        0,
      ),
      transferOutTickets: outgoing.reduce(
        (sum, row) => sum + row.tickets.length,
        0,
      ),
      transferOutAmount: outAmount,
      transferGain: outAmount - outCost,
      scrapTickets: count(TICKET_EVENT_TYPE.scrap),
      // 報廢損失以報廢事件上的成本快照為準(調貨後張的單張成本可能已變)
      scrapCost: events
        .filter((event) => event.type === TICKET_EVENT_TYPE.scrap)
        .reduce((sum, event) => sum + (event.cost ?? 0), 0),
      lostTickets: count(TICKET_EVENT_TYPE.lose),
      lostCost: costOf(TICKET_EVENT_TYPE.lose),
      recoveredTickets: count(TICKET_EVENT_TYPE.recover),
      recoveredCost: costOf(TICKET_EVENT_TYPE.recover),
      skippedTickets:
        count(TICKET_EVENT_TYPE.skip) - count(TICKET_EVENT_TYPE.unskip),
      endingTickets: ending.tickets,
      endingCost: ending.cost,
      investigatingBooks: ending.investigatingBooks,
    };
  }

  /**
   * 期末(期間結束那一刻)的庫存:每一張取「迄」之前最後一筆事件的「變動後」;還在這家店、未售、
   * 位置是庫存或檯面的算期末庫存,待查的算待查(本)。只看曾經在這家店的張(事件後或事件前在這家店:
   * 被調走 / 尋回到別家店的那一筆事件,變動前一定是這家店)。
   */
  private async endingStockOf(
    reader: OperatorContext,
    orgId: Types.ObjectId,
    to: Date,
  ): Promise<{ tickets: number; cost: number; investigatingBooks: number }> {
    const rows = (await this.events.aggregate(reader, [
      {
        $match: {
          at: { $lt: to },
          $or: [{ orgId }, { "from.orgId": orgId }],
        },
      },
      { $sort: { at: 1, _id: 1 } },
      {
        $group: {
          _id: "$ticketId",
          last: { $last: "$to" },
          bookId: { $last: "$bookId" },
        },
      },
      {
        $match: {
          "last.orgId": orgId,
          "last.status": {
            $in: [TICKET_STATUS.unsold, TICKET_STATUS.investigating],
          },
        },
      },
    ])) as {
      _id: Types.ObjectId;
      bookId: Types.ObjectId;
      last: { status: string; locationKind: string };
    }[];
    const onHand = rows.filter(
      (row) =>
        row.last.status === TICKET_STATUS.unsold &&
        ON_HAND_LOCATIONS.has(row.last.locationKind),
    );
    const costs = await this.unitCostsOf(
      reader,
      onHand.map((row) => row._id),
    );
    return {
      tickets: onHand.length,
      cost: onHand.reduce(
        (sum, row) => sum + (costs.get(String(row._id)) ?? 0),
        0,
      ),
      investigatingBooks: new Set(
        rows
          .filter((row) => row.last.status === TICKET_STATUS.investigating)
          .map((row) => String(row.bookId)),
      ).size,
    };
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
    const [movements, checkouts, stocktakes] = await Promise.all([
      this.movements.findMany(
        reader,
        { orgId, occurredAt: { $gte: from, $lt: to } },
        {
          select:
            "type from to amount postCloseOf attributedShiftId occurredAt",
        },
      ),
      this.checkouts.findMany(
        reader,
        { orgId, submittedAt: { $gte: from, $lt: to } },
        {
          select:
            "type shiftId difference stocktakeMode skipReason skipReasonKey",
        },
      ),
      this.stocktakes.findMany(
        reader,
        {
          orgId,
          submittedAt: { $gte: from, $lt: to },
          status: { $ne: STOCKTAKE_STATUS.rejected },
          "summary.uncountedCount": { $gt: 0 },
        },
        { select: "summary" },
      ),
    ]);
    const shiftCheckouts = checkouts.filter(
      (row) => row.type === CHECKOUT_TYPE.shift && row.shiftId !== null,
    );
    const dailies = checkouts.filter((row) => row.type === CHECKOUT_TYPE.daily);
    const shiftIds = shiftCheckouts.flatMap((row) =>
      row.shiftId === null ? [] : [row.shiftId],
    );
    const [ownRows, recordedRows, covering] = await Promise.all([
      this.postClose.rowsOf(reader, { shiftIds }),
      this.postClose.rowsOf(reader, { orgId, from, to }),
      shiftIds.length === 0
        ? Promise.resolve([])
        : this.checkouts.findMany(
            reader,
            {
              orgId,
              type: CHECKOUT_TYPE.daily,
              coveredShiftIds: { $in: shiftIds },
            },
            { select: "coveredShiftIds" },
          ),
    ]);
    const shiftOpenedAt = await this.shiftOpenedAt(reader, [
      ...shiftIds,
      ...recordedRows.map((row) => row.shiftId),
      ...movements.flatMap((row) =>
        row.attributedShiftId === null ? [] : [row.attributedShiftId],
      ),
    ]);
    const isPrior = (shiftId: string, recordedAt: Date) => {
      const openedAt = shiftOpenedAt.get(shiftId);
      return (
        openedAt !== undefined &&
        isPriorPeriodOf(scope, closedAt, openedAt, recordedAt)
      );
    };
    // 這些班的事後更正:指向已關帳月份、關帳之後才記的不算(那個月的數字固定),另歸前期更正
    const current = ownRows.filter(
      (row) => !isPrior(row.shiftId, row.recordedAt),
    );
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

    const net = (type: string) =>
      movements
        .filter((row) => row.type === type && row.postCloseOf === null)
        .reduce((sum, row) => {
          const route = NORMAL_ROUTE[type] ?? {};
          const normal =
            (route.to === undefined || row.to === route.to) &&
            (route.from === undefined || row.from === route.from);
          return sum + (normal ? row.amount : -row.amount);
        }, 0);
    const covered = new Set(
      covering.flatMap((row) => row.coveredShiftIds.map(String)),
    );
    const skipped = new Map<string, number>();
    for (const row of checkouts) {
      if (row.stocktakeMode === "skip") {
        const reason = row.skipReason ?? row.skipReasonKey ?? "";
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      }
    }
    return {
      cash: {
        shiftCount: shiftCheckouts.length,
        shiftDifference: shiftCheckouts.reduce(
          (sum, row) => sum + row.difference,
          0,
        ),
        postClose: postCloseByCategory(current),
        refund: net(CASH_MOVEMENT_TYPE.refund),
        transferExpense: net(CASH_MOVEMENT_TYPE.transferOut),
        transferIncome: net(CASH_MOVEMENT_TYPE.transferIn),
        deposit: net(CASH_MOVEMENT_TYPE.deposit),
        bankDeposit: net(CASH_MOVEMENT_TYPE.bankDeposit),
        dailyCloseCount: dailies.length,
        vaultDifference: dailies.reduce((sum, row) => sum + row.difference, 0),
      },
      notes: {
        skippedStocktakes: [...skipped.entries()]
          .map(([reason, count]) => ({ reason, count }))
          .toSorted((a, b) => b.count - a.count),
        uncountedStocktakes: stocktakes.length,
        uncountedBooks: stocktakes.reduce(
          (sum, row) => sum + row.summary.uncountedCount,
          0,
        ),
        uncoveredShifts: shiftIds.filter((id) => !covered.has(String(id)))
          .length,
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
   * 這家店使用的帳戶(使用組織包含它,或期間內有歸屬這家店的交易):只算歸屬這家店的交易、依類型合計;
   * 期末餘額是整個帳戶的(註明共用)。
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
        { select: "accountId type direction amount" },
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
        const key = `${row.type}|${row.direction}`;
        const entry = totals.get(key) ?? {
          type: row.type,
          direction: row.direction,
          amount: 0,
        };
        entry.amount += row.amount;
        totals.set(key, entry);
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
   * 待付 / 待退批貨款、待收 / 待付調貨款(收付機制的待結清,依歸屬分店;只算期末以前送出的單據)。
   * 收付的現況是「現在」的:報表期間結束之後才付的款不倒推回去(見模組文件「營運報表」)。
   */
  private async outstandingOf(
    operator: OperatorContext,
    scope: ReportScope,
  ): Promise<(period: StorePeriod) => LotteryOperationsOutstandingModel> {
    const rows = await this.settlement.outstanding(operator);
    return (period) => {
      const result: LotteryOperationsOutstandingModel = {
        purchaseToPay: 0,
        purchaseToRefund: 0,
        transferToReceive: 0,
        transferToPay: 0,
      };
      if (!scope.storeIds.some((id) => id.equals(period.orgId))) {
        return result;
      }
      for (const row of rows) {
        const submittedAt = row.snapshot.submission.submittedAt;
        const field = OUTSTANDING_FIELDS[
          `${row.snapshot.registration.kind}|${row.kind}`
        ] as keyof LotteryOperationsOutstandingModel | undefined;
        if (
          field !== undefined &&
          row.branchOrgId.equals(period.orgId) &&
          submittedAt !== null &&
          submittedAt < period.to
        ) {
          result[field] += row.amount;
        }
      }
      return result;
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

  private async shiftOpenedAt(
    reader: OperatorContext,
    ids: readonly (Types.ObjectId | string)[],
  ): Promise<Map<string, Date>> {
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.shifts.findMany(
      reader,
      { _id: { $in: unique } },
      { select: "openedAt" },
    );
    return new Map(rows.map((row) => [String(row._id), row.openedAt]));
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
 * 沒有 `reports.show-cost`:成本與毛利相關欄位一律 null(api 不送出,不只是畫面不顯示)。
 * 直接改這次查詢剛組好的物件(沒有共用)。
 */
function withoutCost(
  store: LotteryOperationsStoreModel,
): LotteryOperationsStoreModel {
  store.sales.cost = null;
  for (const game of store.sales.games) {
    game.cost = null;
  }
  Object.assign(store.inventory, {
    purchaseCost: null,
    transferGain: null,
    scrapCost: null,
    lostCost: null,
    recoveredCost: null,
    endingCost: null,
  });
  return store;
}
