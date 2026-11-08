import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  CASH_CORRECTION_DIRECTION,
  CASH_CORRECTION_PLACE,
  type ReversalPlan,
  type ReversalPlanProblem,
  type ReversalPlanTicket,
  SALE_REVERSAL_LOCK_REF_TYPE,
  STORE_BOARD_SIGNAL,
  type SaleReversalCountLine,
  type SaleReversalLine,
  type SaleReversalValues,
  TICKET_EVENT_TYPE,
  TICKET_STATUS,
  cashCorrectionProblemOf,
  cashCorrectionValuesOf,
  isMatchingCountMode,
  saleReversalPlanOf,
  saleReversalProblemOf,
  saleReversalReturnPlaceOf,
  saleReversalValuesOf,
} from "@repo/domain/project/lottery";
import { PERIOD_CLOSE_REASONS } from "@repo/domain/project/lottery-accounts";
import { boardTopic } from "@repo/domain/realtime";

import type { Persisted } from "../../../database/base.repository";
import {
  FormSubmissionsRepository,
  OrgsRepository,
} from "../../../database/base/repositories";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import type {
  FormEffectContext,
  FormGuardBlock,
  FormGuardResult,
  LifecycleSubmission,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  type LotteryTicketDocument,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryStocktakesRepository } from "../../database/lottery-stocktakes/lottery-stocktakes.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { PeriodLock } from "../accounts/period-lock";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketLockRef } from "../tickets/ticket-ledger.types";
import { StoreClock } from "./store-clock";
import { conflictError, validationError } from "./store-error";
import { StoreMatching, matchEventsOf } from "./store-matching";
import { StoreVaultGuard } from "./store-vault-guard";

/** 兩張表單掛接點擋下的代碼(`FORBIDDEN` + `reason`;模組文件「錯誤碼」)。 */
export const STORE_FORM_BLOCKS = {
  /** 欄位不合(`message` 帶欄位 key):沒選張、張數和張號不一致、退款 = 是沒有退款班次、金額不是正整數… */
  invalid: "STORE_FORM_INVALID",
  /** 分店不在申請人的可見範圍。 */
  branchNotVisible: "STORE_FORM_BRANCH_NOT_VISIBLE",
  /** 選的班不是這家分店的班(退款班次、位置、歸屬班次)。 */
  shiftNotInBranch: "STORE_FORM_SHIFT_NOT_IN_BRANCH",
  /** 有張不是本店已售、或在其他未結束的撤銷售出申請上(張數店另擋跳號、報廢、在途;`message` 帶列與張)。 */
  ticketNotReversible: "SALE_REVERSAL_TICKET_NOT_REVERSIBLE",
  /**
   * 張數店刷的票不是確定張號的已售,刷它的那一台這個遊戲又沒有依張數售出可對號(張數店規格 7.3 第 1、3 點;
   * 同當下撤銷的 `COUNT_SALE_NOT_FOUND`)。
   */
  countSaleNotFound: "SALE_REVERSAL_COUNT_SALE_NOT_FOUND",
  /** 依遊戲 + 張數:這台這個遊戲的已售·未對號不夠(`message` = `available <還有幾張>`;張數店規格 16.4 U7)。 */
  countExceeds: "SALE_REVERSAL_COUNT_EXCEEDS",
  /** 依遊戲 + 張數的收銀點不是這家分店的。 */
  cashPointNotInBranch: "SALE_REVERSAL_CASH_POINT_NOT_IN_BRANCH",
  /** 退款金額 ≠ 這些張數的面額合計。 */
  amountMismatch: "SALE_REVERSAL_AMOUNT_MISMATCH",
  /** 兩張表單完成後都不能作廢(錯了再開一張反向的)。 */
  voidNotAllowed: "STORE_FORM_VOID_NOT_ALLOWED",
  /** 退款班次 / 現金更正的位置(某一班)是已關帳月份的班(規格 10.4;`PeriodLock` 同一個判斷)。 */
  periodClosed: PERIOD_CLOSE_REASONS.periodClosed,
} as const;

/** 撤銷售出申請在張上的鎖(張在這張單上 = 「撤銷審核中」)。 */
export function saleReversalLockOf(
  submissionId: Types.ObjectId,
): TicketLockRef {
  return { refType: SALE_REVERSAL_LOCK_REF_TYPE, refId: submissionId };
}

/** 找重刷「記已售但還在」時最多讀幾張重刷單(新的在前;同一家店同一個遊戲的重刷不多)。 */
const RESCAN_LOOKUP_LIMIT = 50;

/** 現金流水指回單據的 `refType`(模組 key;`refId` = 提交 id)。 */
export const STORE_FORM_CASH_REF_TYPE = "store";

function block(code: string, message: string): FormGuardResult {
  return { code, message };
}

function toObjectId(id: string | null): Types.ObjectId | null {
  return id !== null && Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : null;
}

/** 讀到的張(對號要整張的「狀態 + 位置」,讀整份)。 */
type ReversalTicket = Persisted<LotteryTicketDocument>;

/** 撤銷售出申請送出時的計畫與它用到的張(張 id → 張)。 */
interface ReversalPlanFacts {
  plan: ReversalPlan;
  tickets: Map<string, ReversalTicket>;
}

/** 計畫用的一張(`own` = 這張單自己的鎖不算被鎖住,重送時)。 */
function planTicketOf(
  ticket: ReversalTicket,
  branchId: Types.ObjectId,
  own: TicketLockRef,
): ReversalPlanTicket {
  const lock = ticket.lockedBy ?? null;
  return {
    id: String(ticket._id),
    gameId: String(ticket.gameId),
    inStore: ticket.orgId.equals(branchId),
    status: ticket.status,
    unmatched: ticket.unmatched,
    locked:
      lock !== null &&
      !(lock.refType === own.refType && lock.refId.equals(own.refId)),
    locationKind: ticket.location.kind,
    cashPointId:
      ticket.location.cashPointId == null
        ? null
        : String(ticket.location.cashPointId),
    soldAt: ticket.soldAt ?? null,
    soldSource: ticket.soldSource ?? null,
  };
}

/** 計畫擋下 → 送出前檢查的結果。 */
function planBlockOf(problem: ReversalPlanProblem): FormGuardBlock {
  switch (problem.kind) {
    case "not_reversible": {
      return {
        code: STORE_FORM_BLOCKS.ticketNotReversible,
        message: `row ${problem.rowId} ticket ${problem.ticketId}`,
      };
    }
    case "count_sale_not_found": {
      return {
        code: STORE_FORM_BLOCKS.countSaleNotFound,
        message: `row ${problem.rowId} ticket ${problem.ticketId}`,
      };
    }
    case "count_exceeds": {
      return {
        code: STORE_FORM_BLOCKS.countExceeds,
        message: `available ${String(problem.available)}`,
      };
    }
  }
}

/** 售出類事件(撤銷要回到它記的收銀點)。 */
const SALE_EVENT_TYPES = [
  TICKET_EVENT_TYPE.sale,
  TICKET_EVENT_TYPE.saleStocktake,
] as const;

/** 讀得到的班(只取規則要的欄位)。 */
interface FormShift {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  cashPointId: Types.ObjectId;
  openedAt: Date;
  closedAt: Date | null;
}

/**
 * 店面管理兩張表單的規則(專案規格 8.5、8.8、6.12;正本 `docs/modules/project/store.md`
 * 「撤銷售出申請與現金更正單」)。`store-forms-lifecycle.ts` 的守門與事後動作都委派到這裡。
 *
 * **撤銷售出申請**
 *
 * | 時機 | 做什麼 |
 * | --- | --- |
 * | `beforeSubmit` | 分店看得到;每張是本店已售、沒被別的單鎖定(不在其他未結束的撤銷單上);退款金額 = 面額合計;退款 = 是時退款班次是本店的班、不是已關帳月份的班 |
 * | `submitted` | 張鎖定(`sale_reversal`;盤點時標示「撤銷審核中」) |
 * | `returned` / `withdrawn` / `rejected` | 解除鎖定(駁回什麼都不記;退回 / 撤回後重送再鎖) |
 * | `completed` | 張改回未售、回到原收銀點,寫「撤銷」事件(不影響現金);退款 = 是 → 現金流水「退貨退款」記在退款班次(已結帳 → 事後更正 `postCloseOf`) |
 * | `beforeVoid` | 一律擋下 |
 *
 * **現金更正單**:`beforeSubmit` 檢查位置 / 歸屬班次是本店的班,位置(某一班)不是已關帳月份的班(歸屬班次可以);`completed` 寫現金流水「現金更正」
 * (位置那一班的抽屜或小金庫;另記 `attributedShiftId`;位置那一班已結帳 → 事後更正);`beforeVoid` 一律擋下。
 *
 * 單據可能是總部建的,事後動作的系統身分只看得到單據的組織:讀寫以租戶邊界上下文(登記
 * `project/database/tenant-boundary-callers.ts`),張經帳本的系統寫入(不換店)。
 */
@Injectable()
export class StoreFormsRules {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly orgs: OrgsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly events: LotteryTicketEventsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly games: LotteryGamesRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly stocktakes: LotteryStocktakesRepository,
    private readonly ledger: TicketLedgerService,
    private readonly cash: CashLedgerService,
    private readonly vault: StoreVaultGuard,
    private readonly periods: PeriodLock,
    private readonly matching: StoreMatching,
    private readonly clock: StoreClock,
  ) {}

  // ---- 撤銷售出申請 ----

  async beforeSubmitSaleReversal(
    operator: OperatorContext,
    submission: LifecycleSubmission,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const parsed = saleReversalValuesOf(values);
    const problem = saleReversalProblemOf(parsed);
    if (problem !== null) {
      return block(STORE_FORM_BLOCKS.invalid, problem.field);
    }
    const branchId = toObjectId(parsed.branchId);
    if (branchId === null || !isOrgVisible(operator, branchId)) {
      return block(STORE_FORM_BLOCKS.branchNotVisible, "branch");
    }
    const reader = await this.readerOf(submission.tenantId);
    const own = saleReversalLockOf(submission._id);
    const amounts = await this.amountProblemOf(reader, branchId, parsed);
    if (amounts !== null) {
      return amounts;
    }
    const { plan } = await this.planOf(reader, branchId, parsed, own);
    if (!plan.ok) {
      return planBlockOf(plan.problem);
    }
    const total = [...parsed.lines, ...parsed.countLines].reduce(
      (sum, line) => sum + line.amount,
      0,
    );
    if (parsed.refundAmount !== total) {
      return block(STORE_FORM_BLOCKS.amountMismatch, "refund_amount");
    }
    if (parsed.refund) {
      const shift = await this.shiftOf(reader, parsed.refundShiftId);
      if (!shift?.orgId.equals(branchId)) {
        return block(STORE_FORM_BLOCKS.shiftNotInBranch, "refund_shift");
      }
      if (await this.isClosedPeriod(submission.tenantId, shift)) {
        return block(STORE_FORM_BLOCKS.periodClosed, "refund_shift");
      }
    }
    return null;
  }

  /**
   * 各列的金額 = 面額 × 張數(依張號:這本的遊戲;依遊戲 + 張數:那個遊戲),依遊戲 + 張數的收銀點是這家分店的;
   * 本、遊戲、收銀點各一次讀完(不逐列讀)。合格回 null。
   */
  private async amountProblemOf(
    reader: OperatorContext,
    branchId: Types.ObjectId,
    parsed: SaleReversalValues,
  ): Promise<FormGuardBlock | null> {
    const bookIds = parsed.lines.flatMap((line) => {
      const bookId = toObjectId(line.bookId);
      return bookId === null ? [] : [bookId];
    });
    const books =
      bookIds.length === 0
        ? []
        : await this.books.findMany(
            reader,
            { _id: { $in: bookIds } },
            { select: "gameId" },
          );
    const gameOfBook = new Map(
      books.map((book) => [String(book._id), String(book.gameId)]),
    );
    const gameIds = [
      ...new Set([
        ...books.map((book) => String(book.gameId)),
        ...parsed.countLines.flatMap((line) =>
          line.gameId === null ? [] : [line.gameId],
        ),
      ]),
    ].flatMap((id) => {
      const objectId = toObjectId(id);
      return objectId === null ? [] : [objectId];
    });
    const games =
      gameIds.length === 0
        ? []
        : await this.games.findMany(
            reader,
            { _id: { $in: gameIds } },
            { select: "unitPrice" },
          );
    const unitPriceOf = new Map(
      games.map((game) => [String(game._id), game.unitPrice]),
    );
    for (const line of parsed.lines) {
      const unitPrice = unitPriceOf.get(gameOfBook.get(line.bookId) ?? "");
      if (unitPrice === undefined) {
        return block(STORE_FORM_BLOCKS.ticketNotReversible, line.bookId);
      }
      if (line.amount !== unitPrice * line.ticketNos.length) {
        return block(STORE_FORM_BLOCKS.amountMismatch, `book ${line.bookId}`);
      }
    }
    const pointIds = parsed.countLines.flatMap((line) => {
      const id = toObjectId(line.cashPointId);
      return id === null ? [] : [id];
    });
    const points =
      pointIds.length === 0
        ? []
        : await this.cashPoints.findMany(
            reader,
            { _id: { $in: pointIds }, orgId: branchId },
            { select: "_id" },
          );
    const inBranch = new Set(points.map((point) => String(point._id)));
    for (const line of parsed.countLines) {
      if (!inBranch.has(line.cashPointId ?? "")) {
        return block(STORE_FORM_BLOCKS.cashPointNotInBranch, line.rowId);
      }
      const unitPrice = unitPriceOf.get(line.gameId ?? "");
      if (unitPrice === undefined) {
        return block(STORE_FORM_BLOCKS.ticketNotReversible, line.rowId);
      }
      if (line.amount !== unitPrice * line.count) {
        return block(STORE_FORM_BLOCKS.amountMismatch, line.rowId);
      }
    }
    return null;
  }

  /**
   * 送出時要鎖哪幾張(`saleReversalPlanOf`;張數店規格 7.3 第 1、3 點):依張號各列的張一次讀(張號找不到 → 擋下),
   * 張數店再一次讀相關「遊戲 × 收銀點」的已售·未對號(依張數售出帶著的、依遊戲 + 張數挑的;走
   * `{ orgId, gameId, location.cashPointId, status, soldAt }` 的 partial 索引)。讀的次數與張數、列數無關(TX-06)。
   */
  private async planOf(
    reader: OperatorContext,
    branchId: Types.ObjectId,
    parsed: SaleReversalValues,
    own: TicketLockRef,
    session?: ClientSession,
  ): Promise<ReversalPlanFacts> {
    const ticketsOfBook = await this.ticketsOfLines(
      reader,
      parsed.lines,
      session,
    );
    const tickets = new Map<string, ReversalTicket>();
    const scans: {
      rowId: string;
      ticket: ReversalTicket;
      cashPointId: string | null;
    }[] = [];
    for (const line of parsed.lines) {
      const wanted = new Set(line.ticketNos);
      const rows = (ticketsOfBook.get(line.bookId) ?? []).filter((ticket) =>
        wanted.has(ticket.ticketNo),
      );
      if (rows.length !== line.ticketNos.length) {
        return {
          plan: {
            ok: false,
            problem: {
              kind: "not_reversible",
              rowId: line.rowId,
              ticketId: `book ${line.bookId}`,
            },
          },
          tickets,
        };
      }
      for (const ticket of rows) {
        tickets.set(String(ticket._id), ticket);
        scans.push({
          rowId: line.rowId,
          ticket,
          cashPointId: line.cashPointId,
        });
      }
    }
    const matching = isMatchingCountMode(
      await this.matching.modeOf(reader, branchId),
    );
    const carriers = matching
      ? await this.carriersOf(
          reader,
          branchId,
          scans,
          parsed.countLines,
          session,
        )
      : [];
    for (const ticket of carriers) {
      tickets.set(String(ticket._id), ticket);
    }
    const plan = saleReversalPlanOf({
      matching,
      scans: scans.map((scan) => ({
        rowId: scan.rowId,
        cashPointId: scan.cashPointId,
        ticket: planTicketOf(scan.ticket, branchId, own),
      })),
      carriers: carriers.map((ticket) => planTicketOf(ticket, branchId, own)),
      // 編號店沒有已售·未對號:依遊戲 + 張數一張都挑不到(計畫回 count_exceeds、還有 0 張)
      countLines: parsed.countLines.map((line) => ({
        rowId: line.rowId,
        gameId: line.gameId ?? "",
        cashPointId: line.cashPointId ?? "",
        count: line.count,
      })),
    });
    return { plan, tickets };
  }

  /** 相關「遊戲 × 收銀點」的已售·未對號(一次讀;依張號列要對號的張、依遊戲 + 張數的列)。 */
  private async carriersOf(
    reader: OperatorContext,
    branchId: Types.ObjectId,
    scans: readonly { ticket: ReversalTicket; cashPointId: string | null }[],
    countLines: readonly SaleReversalCountLine[],
    session?: ClientSession,
  ): Promise<ReversalTicket[]> {
    const pairs = new Map<
      string,
      { gameId: Types.ObjectId; cashPointId: Types.ObjectId }
    >();
    const add = (gameId: Types.ObjectId | null, cashPointId: string | null) => {
      const point = toObjectId(cashPointId);
      if (gameId !== null && point !== null) {
        pairs.set(`${String(gameId)}:${String(point)}`, {
          gameId,
          cashPointId: point,
        });
      }
    };
    for (const scan of scans) {
      if (!(
        scan.ticket.status === TICKET_STATUS.sold && !scan.ticket.unmatched
      )) {
        add(scan.ticket.gameId, scan.cashPointId);
      }
    }
    for (const line of countLines) {
      add(toObjectId(line.gameId), line.cashPointId);
    }
    if (pairs.size === 0) {
      return [];
    }
    return this.tickets.findMany(
      reader,
      {
        orgId: branchId,
        status: TICKET_STATUS.sold,
        unmatched: true,
        $or: [...pairs.values()].map((pair) => ({
          gameId: pair.gameId,
          "location.cashPointId": pair.cashPointId,
        })),
      },
      {
        sort: { soldAt: -1, _id: -1 },
        ...(session === undefined ? {} : { session }),
      },
    );
  }

  /**
   * 送出:照送出前檢查同一個計畫,張數店刷的張先對號(兩筆 `match`,這張接手那台最近一筆依張數售出)、
   * 依遊戲 + 張數挑張,再把這張單的張全部鎖定(重送時先解掉不在單上的);都在送出的交易裡。
   *
   * **前提**:計畫已由同一個送出交易裡的 `beforeSubmit`(`beforeSubmitSaleReversal`)檢查過;這裡重算一次
   * (交易內讀到的才是要寫的),算不出來 = 檢查之後被動過 → `CONFLICT`,整個送出回復。別的單先鎖住 →
   * 帳本的鎖定 `CONFLICT`,同樣回復。
   */
  async onSaleReversalSubmitted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const submission = await this.submissionOf(reader, context);
    const parsed = saleReversalValuesOf(submission.values);
    const branchId = toObjectId(parsed.branchId);
    if (branchId === null) {
      throw validationError(
        `sale reversal ${String(context.submissionId)} has no branch`,
        ["branch"],
      );
    }
    const lock = saleReversalLockOf(context.submissionId);
    const { plan, tickets } = await this.planOf(
      reader,
      branchId,
      parsed,
      lock,
      context.session,
    );
    if (!plan.ok) {
      throw conflictError(
        `sale reversal ${String(context.submissionId)} changed before submit: ${plan.problem.kind}`,
      );
    }
    const ticketOf = (id: string): ReversalTicket => {
      const ticket = tickets.get(id);
      if (ticket === undefined) {
        throw conflictError(`ticket ${id} is gone`);
      }
      return ticket;
    };
    if (plan.matches.length > 0) {
      const now = this.clock.now();
      await this.ledger.applyTicketEvents(
        context.session,
        {
          operator: null,
          crossStoreTenantId: tenantId,
          systemActorId: context.actorId ?? submission.createdBy ?? null,
        },
        plan.matches.flatMap((match) =>
          matchEventsOf(
            ticketOf(match.scannedId),
            ticketOf(match.partnerId),
            now,
          ),
        ),
      );
    }
    const wanted = [
      ...plan.byNumber,
      ...plan.matches.map((match) => match.scannedId),
      ...plan.picked.flatMap((row) => row.ticketIds),
    ].map((id) => ticketOf(id)._id);
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const keep = new Set(wanted.map(String));
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      locked
        .filter((ticket) => !keep.has(String(ticket._id)))
        .map((ticket) => ticket._id),
      lock,
    );
    // 別的單已經鎖住(同時送出兩張撤銷單、或剛被調貨)→ 帳本 `CONFLICT`,整個送出回復
    await this.ledger.lockTicketsInTenant(
      context.session,
      tenantId,
      wanted,
      lock,
    );
    this.publishBoard(context, parsed.branchId);
  }

  /** 退回 / 撤回 / 駁回:解除這張單的鎖(駁回什麼都不記;送出時的對號是更正實體,不退回)。 */
  async onSaleReversalReleased(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      locked.map((ticket) => ticket._id),
      saleReversalLockOf(context.submissionId),
    );
  }

  /**
   * 完成:張改回未售,寫「撤銷」事件(現金由退貨退款流水記,事件不影響現金);解除鎖定;退款 = 是 →
   * 現金流水「退貨退款」(抽屜 → 外部)記在退款班次。撤的是張現在帶著的那筆售出(`saleEventId`;
   * 對號會換張,張數店規格 5.1);張回到那筆售出的收銀點,盤點多出的申請(全店重刷列出記已售但還在、
   * 從那個位置送的)回到重刷刷到的位置(`saleReversalReturnPlaceOf`,7.3 第 5 點)。
   */
  async onSaleReversalCompleted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const submission = await this.submissionOf(reader, context);
    const parsed = saleReversalValuesOf(submission.values);
    const lock = saleReversalLockOf(context.submissionId);
    const locked = await this.lockedTicketsOf(
      reader,
      context.submissionId,
      context.session,
    );
    const sales = await this.carriedSalesOf(reader, locked, context.session);
    const lineCashPoints = this.lineCashPointsOf(parsed.lines, locked);
    const rescanPlaces = await this.rescanPlacesOf(
      reader,
      toObjectId(parsed.branchId),
      locked.filter((ticket) => lineCashPoints.has(String(ticket._id))),
      context.session,
    );
    await this.ledger.applyTicketEvents(
      context.session,
      {
        operator: null,
        crossStoreTenantId: tenantId,
        systemActorId: submission.createdBy ?? null,
      },
      locked.map((ticket) => {
        const id = String(ticket._id);
        const sale = sales.get(id);
        const saleCashPointId =
          sale?.cashPointId ?? ticket.location.cashPointId ?? null;
        const place = saleReversalReturnPlaceOf({
          saleCashPointId:
            saleCashPointId === null ? null : String(saleCashPointId),
          lineCashPointId: lineCashPoints.get(id) ?? null,
          rescanPlace: lineCashPoints.has(id)
            ? (rescanPlaces.get(id) ?? null)
            : null,
        });
        const placeId = toObjectId(place?.cashPointId ?? null);
        return {
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.sold],
          allowLockedBy: lock,
          type: TICKET_EVENT_TYPE.saleUndo,
          patch: {
            status: TICKET_STATUS.unsold,
            sold: null,
            ...(place === null
              ? {}
              : {
                  location: {
                    kind: place.locationKind,
                    cashPointId: placeId,
                  },
                }),
          },
          amount: sale?.amount ?? 0,
          cashEffect: "none",
          cashPointId: place === null ? saleCashPointId : placeId,
          refType: SALE_REVERSAL_LOCK_REF_TYPE,
          refId: context.submissionId,
        };
      }),
    );
    await this.ledger.unlockTicketsInTenant(
      context.session,
      tenantId,
      locked.map((ticket) => ticket._id),
      lock,
    );
    if (parsed.refund && parsed.refundAmount > 0) {
      const shift = await this.shiftOf(
        reader,
        parsed.refundShiftId,
        context.session,
      );
      if (shift === null) {
        // 送出前檢查過;完成時讀不到 = 這段時間被刪了(不以 0 元或別的班代替)
        throw conflictError(
          `refund shift of sale reversal ${String(context.submissionId)} is gone`,
        );
      }
      await this.recordDrawer(reader, context, shift, {
        type: "refund",
        from: "drawer",
        to: "external",
        amount: parsed.refundAmount,
        attributedShiftId: null,
        note: parsed.note,
      });
    }
    this.publishBoard(context, parsed.branchId);
  }

  /** 依張號列的張 → 那一列記的位置(刷退票的那一台;重刷進來的 = 重刷刷到的位置,庫存 = null)。 */
  private lineCashPointsOf(
    lines: readonly SaleReversalLine[],
    tickets: readonly ReversalTicket[],
  ): Map<string, string | null> {
    const byKey = new Map<string, string | null>();
    for (const line of lines) {
      for (const no of line.ticketNos) {
        byKey.set(`${line.bookId}:${no}`, line.cashPointId);
      }
    }
    const result = new Map<string, string | null>();
    for (const ticket of tickets) {
      const key = `${String(ticket.bookId)}:${ticket.ticketNo}`;
      if (byKey.has(key)) {
        result.set(String(ticket._id), byKey.get(key) ?? null);
      }
    }
    return result;
  }

  /**
   * 這些張最近一次全店重刷「記已售但還在」的位置(張 id → 位置;張數店規格 7.3 第 5 點、8.4 第 3 點):
   * 一次讀這家店這些遊戲的重刷單(走 `{ orgId, rescan.gameId, status }` 的 partial 索引,新的在前、有上限)。
   */
  private async rescanPlacesOf(
    reader: OperatorContext,
    branchId: Types.ObjectId | null,
    tickets: readonly ReversalTicket[],
    session: ClientSession,
  ): Promise<Map<string, { cashPointId: string | null }>> {
    const places = new Map<string, { cashPointId: string | null }>();
    if (branchId === null || tickets.length === 0) {
      return places;
    }
    const ticketIds = tickets.map((ticket) => ticket._id);
    const rows = await this.stocktakes.findMany(
      reader,
      {
        orgId: branchId,
        purpose: "rescan",
        "rescan.gameId": {
          $in: [
            ...new Map(
              tickets.map((t) => [String(t.gameId), t.gameId]),
            ).values(),
          ],
        },
        "rescan.results": {
          $elemMatch: { ticketId: { $in: ticketIds }, outcome: "sold_here" },
        },
      },
      {
        select: "rescan.results startedAt",
        sort: { startedAt: -1, _id: -1 },
        limit: RESCAN_LOOKUP_LIMIT,
        session,
      },
    );
    const wanted = new Set(ticketIds.map(String));
    for (const row of rows) {
      for (const result of row.rescan?.results ?? []) {
        const id = String(result.ticketId);
        if (
          result.outcome === "sold_here" &&
          wanted.has(id) &&
          !places.has(id)
        ) {
          places.set(id, {
            cashPointId:
              result.cashPointId == null ? null : String(result.cashPointId),
          });
        }
      }
    }
    return places;
  }

  /**
   * 每張現在帶著的那筆售出(張 id → 收銀點與金額):有 `saleEventId` 的一次讀那些售出事件;
   * 沒有的(張數店以前賣的舊資料)照舊取這張最近一次售出。
   */
  private async carriedSalesOf(
    reader: OperatorContext,
    tickets: readonly ReversalTicket[],
    session: ClientSession,
  ): Promise<
    Map<string, { cashPointId: Types.ObjectId | null; amount: number }>
  > {
    const eventIds = tickets.flatMap((ticket) =>
      ticket.saleEventId == null ? [] : [ticket.saleEventId],
    );
    const carried =
      eventIds.length === 0
        ? []
        : await this.events.findMany(
            reader,
            { eventId: { $in: eventIds } },
            { select: "eventId cashPointId amount", session },
          );
    const byEvent = new Map(carried.map((row) => [row.eventId, row]));
    const result = new Map<
      string,
      { cashPointId: Types.ObjectId | null; amount: number }
    >();
    const legacy: Types.ObjectId[] = [];
    for (const ticket of tickets) {
      const sale =
        ticket.saleEventId == null
          ? undefined
          : byEvent.get(ticket.saleEventId);
      if (sale === undefined) {
        legacy.push(ticket._id);
      } else {
        result.set(String(ticket._id), {
          cashPointId: sale.cashPointId ?? null,
          amount: sale.amount,
        });
      }
    }
    for (const [id, sale] of await this.lastSalesOf(reader, legacy, session)) {
      result.set(id, sale);
    }
    return result;
  }

  // ---- 現金更正單 ----

  async beforeSubmitCashCorrection(
    operator: OperatorContext,
    submission: LifecycleSubmission,
    values: StoredValues,
  ): Promise<FormGuardResult> {
    const parsed = cashCorrectionValuesOf(values);
    const problem = cashCorrectionProblemOf(parsed);
    if (problem !== null) {
      return block(STORE_FORM_BLOCKS.invalid, problem.field);
    }
    const branchId = toObjectId(parsed.branchId);
    if (branchId === null || !isOrgVisible(operator, branchId)) {
      return block(STORE_FORM_BLOCKS.branchNotVisible, "branch");
    }
    const reader = await this.readerOf(submission.tenantId);
    if (parsed.place === CASH_CORRECTION_PLACE.drawer) {
      const shift = await this.shiftOf(reader, parsed.shiftId);
      if (!shift?.orgId.equals(branchId)) {
        return block(STORE_FORM_BLOCKS.shiftNotInBranch, "shift");
      }
      if (await this.isClosedPeriod(submission.tenantId, shift)) {
        return block(STORE_FORM_BLOCKS.periodClosed, "shift");
      }
    }
    if (parsed.attributedShiftId !== null) {
      // 歸屬班次只表示是誰的責任:可以選已結帳、已關帳月份的班(報表歸「前期更正」),但要是本店的班
      const shift = await this.shiftOf(reader, parsed.attributedShiftId);
      if (!shift?.orgId.equals(branchId)) {
        return block(STORE_FORM_BLOCKS.shiftNotInBranch, "attributed_shift");
      }
    }
    return null;
  }

  /** 完成:寫現金流水「現金更正」(位置那一班的抽屜或小金庫;另記歸屬班次)。 */
  async onCashCorrectionCompleted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const submission = await this.submissionOf(reader, context);
    const parsed = cashCorrectionValuesOf(submission.values);
    const branchId = toObjectId(parsed.branchId);
    if (branchId === null || parsed.direction === null) {
      throw validationError(
        `cash correction ${String(context.submissionId)} has incomplete values`,
        ["branch", "direction"],
      );
    }
    const increase = parsed.direction === CASH_CORRECTION_DIRECTION.increase;
    const type = increase ? "correction_increase" : "correction_decrease";
    const attributedShiftId = toObjectId(parsed.attributedShiftId);
    if (parsed.place === CASH_CORRECTION_PLACE.vault) {
      // 小金庫:和出庫、開班領零用金在同一個守門文件上序列化(規格 6.7)
      await this.vault.serialize(reader, branchId, context.session);
      await this.cash.recordCashMovement(context.session, {
        operator: reader,
        orgId: branchId,
        type,
        from: increase ? "external" : "vault",
        to: increase ? "vault" : "external",
        amount: parsed.amount,
        attributedShiftId,
        refType: STORE_FORM_CASH_REF_TYPE,
        refId: context.submissionId,
        refRevision: context.revision,
        note: parsed.note,
      });
    } else {
      const shift = await this.shiftOf(reader, parsed.shiftId, context.session);
      if (shift === null) {
        throw conflictError(
          `shift of cash correction ${String(context.submissionId)} is gone`,
        );
      }
      await this.recordDrawer(reader, context, shift, {
        type,
        from: increase ? "external" : "drawer",
        to: increase ? "drawer" : "external",
        amount: parsed.amount,
        attributedShiftId,
        note: parsed.note,
      });
    }
    this.publishBoard(context, parsed.branchId);
  }

  // ---- 共用 ----

  /**
   * 寫在某一班抽屜的流水:班開著 → 先鎖住那一班(`drawerVersion` +1,和投庫 / 出庫 / 銷售序列化),
   * 計入應有;班已送出交班結帳 → 記成那一班的事後更正(`postCloseOf`,規格 6.12)。
   */
  private async recordDrawer(
    reader: OperatorContext,
    context: FormEffectContext,
    shift: FormShift,
    movement: {
      type: "refund" | "correction_increase" | "correction_decrease";
      from: "drawer" | "external";
      to: "drawer" | "external";
      amount: number;
      attributedShiftId: Types.ObjectId | null;
      note: string | null;
    },
  ): Promise<void> {
    const isOpen = shift.closedAt === null;
    if (isOpen) {
      await this.shifts.updateById(
        reader,
        shift._id,
        { $inc: { drawerVersion: 1 } },
        { session: context.session },
      );
    }
    await this.cash.recordCashMovement(context.session, {
      operator: reader,
      orgId: shift.orgId,
      type: movement.type,
      from: movement.from,
      to: movement.to,
      amount: movement.amount,
      cashPointId: shift.cashPointId,
      shiftId: shift._id,
      attributedShiftId: movement.attributedShiftId,
      postCloseOf: isOpen ? null : shift._id,
      refType: STORE_FORM_CASH_REF_TYPE,
      refId: context.submissionId,
      refRevision: context.revision,
      note: movement.note,
    });
  }

  /** 兩張表單完成後都不能作廢(規格 8.5、8.8:作廢前一律擋下;錯了再開一張反向的)。 */
  beforeVoid(): FormGuardResult {
    return block(STORE_FORM_BLOCKS.voidNotAllowed, "void is not allowed");
  }

  /** 這一班(以開班時間)落在已關帳的月份(`PeriodLock` 的唯一判斷;守門回擋下、不拋錯)。 */
  private async isClosedPeriod(
    tenantId: Types.ObjectId | null,
    shift: FormShift,
  ): Promise<boolean> {
    return (
      (await this.periods.closedPeriodOf(tenantId, shift.openedAt)) !== null
    );
  }

  private readerOf(tenantId: Types.ObjectId | null): Promise<OperatorContext> {
    return tenantBoundaryContext(this.orgs, null, tenantId);
  }

  private async submissionOf(
    reader: OperatorContext,
    context: FormEffectContext,
  ) {
    const submission = await this.submissions.findById(
      reader,
      context.submissionId,
      { session: context.session },
    );
    if (!submission) {
      throw conflictError(`submission ${String(context.submissionId)} is gone`);
    }
    return submission;
  }

  private async shiftOf(
    reader: OperatorContext,
    idText: string | null,
    session?: ClientSession,
  ): Promise<FormShift | null> {
    const id = toObjectId(idText);
    if (id === null) {
      return null;
    }
    return this.shifts.findById(reader, id, {
      select: "orgId cashPointId openedAt closedAt",
      session,
    });
  }

  /** 各列(本 + 張號)的張:一次讀完,本 id → 張(依張號排序)。 */
  private async ticketsOfLines(
    reader: OperatorContext,
    lines: readonly SaleReversalLine[],
    session?: ClientSession,
  ): Promise<Map<string, ReversalTicket[]>> {
    const wanted = lines.flatMap((line) => {
      const bookId = toObjectId(line.bookId);
      return bookId === null || line.ticketNos.length === 0
        ? []
        : [{ bookId, ticketNo: { $in: [...line.ticketNos] } }];
    });
    const byBook = new Map<string, ReversalTicket[]>();
    if (wanted.length === 0) {
      return byBook;
    }
    const rows: ReversalTicket[] = await this.tickets.findMany(
      reader,
      { $or: wanted },
      { sort: { bookId: 1, ticketNo: 1 }, session },
    );
    for (const ticket of rows) {
      const key = String(ticket.bookId);
      byBook.set(key, [...(byBook.get(key) ?? []), ticket]);
    }
    return byBook;
  }

  private async lockedTicketsOf(
    reader: OperatorContext,
    submissionId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ReversalTicket[]> {
    return this.tickets.findMany(
      reader,
      {
        "lockedBy.refType": SALE_REVERSAL_LOCK_REF_TYPE,
        "lockedBy.refId": submissionId,
      },
      { sort: { bookId: 1, ticketNo: 1 }, session },
    );
  }

  /** 每張最近一次售出(張 id → 收銀點與金額)。 */
  private async lastSalesOf(
    reader: OperatorContext,
    ticketIds: readonly Types.ObjectId[],
    session: ClientSession,
  ): Promise<
    Map<string, { cashPointId: Types.ObjectId | null; amount: number }>
  > {
    if (ticketIds.length === 0) {
      return new Map();
    }
    const rows = await this.events.findMany(
      reader,
      {
        ticketId: { $in: [...ticketIds] },
        type: { $in: [...SALE_EVENT_TYPES] },
      },
      { select: "ticketId cashPointId amount at", sort: { at: -1 }, session },
    );
    const latest = new Map<
      string,
      { cashPointId: Types.ObjectId | null; amount: number }
    >();
    for (const row of rows) {
      const key = String(row.ticketId);
      if (!latest.has(key)) {
        latest.set(key, { cashPointId: row.cashPointId, amount: row.amount });
      }
    }
    return latest;
  }

  /** 看板有變:提交後對 `board:<分店>` 送 `board` 信號。 */
  private publishBoard(
    context: FormEffectContext,
    branchId: string | null,
  ): void {
    if (branchId !== null) {
      context.realtime.publishAfterCommit([boardTopic(branchId)], {
        type: STORE_BOARD_SIGNAL,
      });
    }
  }
}
