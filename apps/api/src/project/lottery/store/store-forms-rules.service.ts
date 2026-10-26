import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import type { StoredValues } from "@repo/domain/form";
import {
  CASH_CORRECTION_DIRECTION,
  CASH_CORRECTION_PLACE,
  SALE_REVERSAL_LOCK_REF_TYPE,
  STORE_BOARD_SIGNAL,
  type SaleReversalLine,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketLocationKind,
  type TicketStatus,
  cashCorrectionProblemOf,
  cashCorrectionValuesOf,
  saleReversalProblemOf,
  saleReversalValuesOf,
} from "@repo/domain/project/lottery";
import { PERIOD_CLOSE_REASONS } from "@repo/domain/project/lottery-accounts";
import { boardTopic } from "@repo/domain/realtime";

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
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { PeriodLock } from "../accounts/period-lock";
import { CashLedgerService } from "../cash/cash-ledger.service";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketLockRef } from "../tickets/ticket-ledger.types";
import { conflictError, validationError } from "./store-error";
import { StoreVaultGuard } from "./store-vault-guard";

/** 兩張表單掛接點擋下的代碼(`FORBIDDEN` + `reason`;模組文件「錯誤碼」)。 */
export const STORE_FORM_BLOCKS = {
  /** 欄位不合(`message` 帶欄位 key):沒選張、張數和張號不一致、退款 = 是沒有退款班次、金額不是正整數… */
  invalid: "STORE_FORM_INVALID",
  /** 分店不在申請人的可見範圍。 */
  branchNotVisible: "STORE_FORM_BRANCH_NOT_VISIBLE",
  /** 選的班不是這家分店的班(退款班次、位置、歸屬班次)。 */
  shiftNotInBranch: "STORE_FORM_SHIFT_NOT_IN_BRANCH",
  /** 有張不是本店已售、或在其他未結束的撤銷售出申請上。 */
  ticketNotReversible: "SALE_REVERSAL_TICKET_NOT_REVERSIBLE",
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

/** 讀到的張(規則判斷用的欄位)。 */
interface ReversalTicket {
  _id: Types.ObjectId;
  bookId: Types.ObjectId;
  orgId: Types.ObjectId;
  ticketNo: string;
  status: TicketStatus;
  location: { kind: TicketLocationKind; cashPointId: Types.ObjectId | null };
  lockedBy: { refType: string; refId: Types.ObjectId } | null;
  version: number;
}

const TICKET_SELECT = "bookId orgId ticketNo status location lockedBy version";

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
    private readonly ledger: TicketLedgerService,
    private readonly cash: CashLedgerService,
    private readonly vault: StoreVaultGuard,
    private readonly periods: PeriodLock,
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
    const facts = await this.lineFactsOf(reader, parsed.lines);
    let total = 0;
    for (const line of parsed.lines) {
      const lineProblem = this.lineProblemOf(facts, branchId, own, line);
      if (lineProblem !== null) {
        return lineProblem;
      }
      // 合格的列:金額已核對 = 面額 × 張數
      total += line.amount;
    }
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

  /** 撤銷售出申請各列要的本、遊戲面額與張:一次讀完(不逐列讀)。 */
  private async lineFactsOf(
    reader: OperatorContext,
    lines: readonly SaleReversalLine[],
  ): Promise<{
    gameOfBook: Map<string, Types.ObjectId>;
    unitPriceOfGame: Map<string, number>;
    ticketsOfBook: Map<string, ReversalTicket[]>;
  }> {
    const bookIds = lines.flatMap((line) => {
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
    const gameIds = books.map((book) => book.gameId);
    const games =
      gameIds.length === 0
        ? []
        : await this.games.findMany(
            reader,
            { _id: { $in: gameIds } },
            { select: "unitPrice" },
          );
    return {
      gameOfBook: new Map(books.map((book) => [String(book._id), book.gameId])),
      unitPriceOfGame: new Map(
        games.map((game) => [String(game._id), game.unitPrice]),
      ),
      ticketsOfBook: await this.ticketsOfLines(reader, lines),
    };
  }

  /**
   * 撤銷售出申請的一列(一本):每張是本店已售、沒被別的單鎖定(這張單自己的鎖可以,重送時);金額 = 面額 × 張數。
   * 合格回 null,不合回擋下的結果。
   */
  private lineProblemOf(
    facts: Awaited<ReturnType<StoreFormsRules["lineFactsOf"]>>,
    branchId: Types.ObjectId,
    own: TicketLockRef,
    line: SaleReversalLine,
  ): FormGuardBlock | null {
    const bookId = toObjectId(line.bookId);
    const gameId =
      bookId === null ? undefined : facts.gameOfBook.get(String(bookId));
    const unitPrice =
      gameId === undefined
        ? undefined
        : facts.unitPriceOfGame.get(String(gameId));
    if (bookId === null || unitPrice === undefined) {
      return {
        code: STORE_FORM_BLOCKS.ticketNotReversible,
        message: line.bookId,
      };
    }
    const wanted = new Set(line.ticketNos);
    const rows = (facts.ticketsOfBook.get(String(bookId)) ?? []).filter(
      (ticket) => wanted.has(ticket.ticketNo),
    );
    const reversible = rows.filter(
      (ticket) =>
        ticket.orgId.equals(branchId) &&
        ticket.status === TICKET_STATUS.sold &&
        (ticket.lockedBy === null ||
          (ticket.lockedBy.refType === own.refType &&
            ticket.lockedBy.refId.equals(own.refId))),
    );
    if (reversible.length !== line.ticketNos.length) {
      return {
        code: STORE_FORM_BLOCKS.ticketNotReversible,
        message: `book ${line.bookId}`,
      };
    }
    return line.amount === unitPrice * line.ticketNos.length
      ? null
      : {
          code: STORE_FORM_BLOCKS.amountMismatch,
          message: `book ${line.bookId}`,
        };
  }

  /**
   * 送出:這張單的張全部鎖定(重送時先解掉不在單上的)。
   *
   * **前提**:「本店已售、沒被別的單鎖定」已由同一個送出交易裡的 `beforeSubmit`(`beforeSubmitSaleReversal`)
   * 檢查過,這裡不再檢查狀態,只鎖;檢查之後到鎖定之前有人動過(別的單先鎖住)→ 帳本的鎖定 `CONFLICT`,
   * 整個送出回復。
   */
  async onSaleReversalSubmitted(context: FormEffectContext): Promise<void> {
    const tenantId = context.tenantId;
    if (tenantId === null) {
      return;
    }
    const reader = await this.readerOf(tenantId);
    const submission = await this.submissionOf(reader, context);
    const parsed = saleReversalValuesOf(submission.values);
    const lock = saleReversalLockOf(context.submissionId);
    const ticketsOfBook = await this.ticketsOfLines(
      reader,
      parsed.lines,
      context.session,
    );
    const wanted: Types.ObjectId[] = [];
    for (const line of parsed.lines) {
      const bookId = toObjectId(line.bookId);
      if (bookId === null) {
        continue;
      }
      const ticketNos = new Set(line.ticketNos);
      wanted.push(
        ...(ticketsOfBook.get(String(bookId)) ?? [])
          .filter((ticket) => ticketNos.has(ticket.ticketNo))
          .map((ticket) => ticket._id),
      );
    }
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

  /** 退回 / 撤回 / 駁回:解除這張單的鎖(駁回什麼都不記)。 */
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
   * 完成:張改回未售、回到原收銀點(最近一次售出記的收銀點),寫「撤銷」事件(現金由退貨退款流水記,
   * 事件不影響現金);解除鎖定;退款 = 是 → 現金流水「退貨退款」(抽屜 → 外部)記在退款班次。
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
    const sales = await this.lastSalesOf(
      reader,
      locked.map((ticket) => ticket._id),
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
        const sale = sales.get(String(ticket._id));
        const cashPointId =
          sale?.cashPointId ?? ticket.location.cashPointId ?? null;
        return {
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.sold],
          allowLockedBy: lock,
          type: TICKET_EVENT_TYPE.saleUndo,
          patch: {
            status: TICKET_STATUS.unsold,
            sold: null,
            ...(cashPointId === null
              ? {}
              : {
                  location: {
                    kind: TICKET_LOCATION_KIND.counter,
                    cashPointId,
                  },
                }),
          },
          amount: sale?.amount ?? 0,
          cashEffect: "none",
          cashPointId,
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
      { select: TICKET_SELECT, sort: { bookId: 1, ticketNo: 1 }, session },
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
      { select: TICKET_SELECT, sort: { bookId: 1, ticketNo: 1 }, session },
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
