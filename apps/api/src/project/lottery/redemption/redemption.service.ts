import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  REDEMPTION_IMMEDIATE_REVOKE_REASON,
  REDEMPTION_MAX_PRIZE,
  REDEMPTION_SERIAL_FORMAT,
  REDEMPTION_SERIAL_KEY,
  REDEMPTION_STATUS,
  STORE_PERMISSIONS,
  displayTicketKey,
  isRedemptionStatus,
  parseTicketInput,
  redemptionRevokeStateOf,
  ticketKeyOf,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantIdOfOrg } from "../../../database/tenant-id";
import { TransactionService } from "../../../database/transaction";
import { FieldOptionsService } from "../../../fields/field-options.service";
import { RealtimePublisher } from "../../../realtime/realtime-publisher.service";
import { SerialService } from "../../../serials/serial.service";
import { LotteryCashPointsRepository } from "../../database/lottery-cash-points/lottery-cash-points.repository";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import { LotteryTicketsRepository } from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryRedemptionsRepository } from "../../database/lottery-redemptions/lottery-redemptions.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import { isDuplicateKeyError } from "../accounts/accounts-error";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { expectedDrawerCash } from "../store/drawer-cash";
import { type ShiftRecord, parseId } from "../store/shift-views";
import { StoreAccess, type StoreGrant } from "../store/store-access";
import { publishStoreBoard } from "../store/store-board-signal";
import type {
  LotteryRedemptionPreviewInput,
  RedeemLotteryTicketInput,
  ReplaceLotteryRedemptionInput,
  RevokeLotteryRedemptionInput,
} from "./dto/redemption.input";
import type {
  LotteryRedemptionModel,
  LotteryRedemptionPreviewModel,
} from "./models/redemption.model";
import {
  REDEMPTION_REASONS,
  forbiddenError,
  notFoundError,
  validationError,
} from "./redemption-error";
import { type RedemptionRecord, RedemptionViews } from "./redemption-views";

/** 稽核的 targetType 與動作名(模組文件「稽核」節)。 */
export const REDEMPTION_AUDIT = {
  target: "lottery_redemption",
  revoke: "lottery-redemption.revoke",
} as const;

/** 刷到的編號解析後的那一張。 */
interface ResolvedTicket {
  /** 那家店所屬的租戶(查「已兌過」以整個租戶為準) */
  tenantId: Types.ObjectId | null;
  gameCode: string;
  gameId: Types.ObjectId | null;
  gameName: string | null;
  unitPrice: number | null;
  bookNo: string;
  ticketNo: string;
  ticketLabel: string;
  /** 本店的張;不是本店的 = null */
  ticketId: Types.ObjectId | null;
}

function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}

function assertPrize(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw validationError("prize must be a positive integer", ["prizeAmount"]);
  }
  if (amount > REDEMPTION_MAX_PRIZE) {
    throw validationError(
      "prize over 5,000 must be redeemed at the bank",
      ["prizeAmount"],
      REDEMPTION_REASONS.overLimit,
    );
  }
}

/**
 * 兌獎、撤銷兌獎、[撤銷並重新登記](專案規格 6.5、6.12;正本 `docs/modules/project/store.md`「兌獎」)。
 * 都不用審核、做完就生效;動到開著的班的抽屜時,交易內先把班的 `drawerVersion` +1(同投庫 / 出庫),
 * 兩個同時的動作互相衝突、重試時依序檢查。寫入後對 `board:<分店>` 送看板信號。
 */
@Injectable()
export class RedemptionService {
  constructor(
    private readonly redemptions: LotteryRedemptionsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly cashPoints: LotteryCashPointsRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly orgs: OrgsRepository,
    private readonly fieldOptions: FieldOptionsService,
    private readonly transactions: TransactionService,
    private readonly realtime: RealtimePublisher,
    private readonly audit: AuditService,
    private readonly access: StoreAccess,
    private readonly views: RedemptionViews,
    private readonly serials: SerialService,
  ) {}

  /** 兌獎視窗的預覽(刷到編號後;`store.redeem`)。 */
  async preview(
    operator: OperatorContext,
    input: LotteryRedemptionPreviewInput,
  ): Promise<LotteryRedemptionPreviewModel> {
    const orgId = parseId(input.orgId);
    if (orgId === null) {
      throw notFoundError(`org not found: ${input.orgId}`);
    }
    const ticket = await this.resolveTicket(operator, orgId, input.code);
    const existing = await this.activeOf(operator, ticket);
    return {
      gameCode: ticket.gameCode,
      gameName: ticket.gameName,
      unitPrice: ticket.unitPrice,
      bookNo: ticket.bookNo,
      ticketNo: ticket.ticketNo,
      ticketLabel: ticket.ticketLabel,
      isOwnStore: ticket.ticketId !== null,
      existing,
    };
  }

  /** 兌獎(`store.redeem`):班要開著;金額 ≤ 5,000、≤ 抽屜應有;同一張未撤銷的不能兌兩次。 */
  async redeem(
    operator: OperatorContext,
    input: RedeemLotteryTicketInput,
  ): Promise<LotteryRedemptionModel> {
    assertPrize(input.prizeAmount);
    const shift = await this.mustShift(operator, input.shiftId);
    if (shift.closedAt !== null) {
      throw validationError(
        "this shift has been checked out",
        ["shiftId"],
        REDEMPTION_REASONS.shiftClosed,
      );
    }
    const ticket = await this.resolveTicket(operator, shift.orgId, input.code);
    await this.assertNotRedeemed(operator, ticket);
    const created = await this.withDuplicateGuard(operator, ticket, () =>
      this.transactions.withTransaction(async () => {
        const locked = await this.lockOpenShift(operator, shift);
        await this.assertDrawerCovers(operator, locked, input.prizeAmount);
        const row = await this.insert(operator, locked, ticket, {
          rawInput: input.code,
          prizeAmount: input.prizeAmount,
          note: trimmed(input.note),
          replacesId: null,
          postCloseOf: null,
        });
        await publishStoreBoard(this.realtime, locked.tenantId, locked.orgId);
        return row;
      }),
    );
    return this.modelOf(operator, created);
  }

  /**
   * 撤銷兌獎(兩層,規格 6.5):自己登記、班開著、有 `store.redeem` → 原因固定「當下撤銷」;
   * 其他要 `store.undo-redeem` 與原因。已送兌 → 擋下;已結帳 → 記 `revokePostCloseOf`(事後更正)。
   */
  async revoke(
    operator: OperatorContext,
    input: RevokeLotteryRedemptionInput,
  ): Promise<LotteryRedemptionModel> {
    const grant = await this.access.grantOf(operator);
    const row = await this.mustRedemption(operator, input.id);
    const shift = await this.shiftOf(operator, row);
    const mode = this.assertRevocable(operator, grant, row, shift);
    const reason =
      mode === "self"
        ? null
        : await this.fieldOptions.assertReason(
            operator,
            LOTTERY_FIELD_CATEGORY_KEYS.redemptionRevokeReason,
            {
              reasonKey: input.reasonKey ?? null,
              reasonNote: input.reasonNote ?? null,
            },
            LOTTERY_FIELD_CATEGORIES,
          );
    const revoked = await this.transactions.withTransaction(async () => {
      const current = await this.lockShiftIfOpen(operator, shift);
      // 自己撤銷只限班還開著:剛好在這時交班 → 擋下(不讓交班那一刻變成事後更正,改由店長撤銷)
      if (mode === "self" && current.closedAt !== null) {
        throw validationError(
          "this shift has been checked out",
          ["id"],
          REDEMPTION_REASONS.shiftClosed,
        );
      }
      const next = await this.markRevoked(operator, row, current, reason);
      await publishStoreBoard(this.realtime, row.tenantId, row.orgId);
      return next;
    });
    return this.modelOf(operator, revoked);
  }

  /**
   * [撤銷並重新登記](`store.undo-redeem`,規格 6.5、6.12):撤銷原紀錄 + 在同一班登記正確的那筆
   * (`replacesId` 指向原紀錄),同一個交易。那一班已結帳 → 兩筆都記成那一班的事後更正;還開著 → 照兌獎檢查抽屜應有。
   */
  async replace(
    operator: OperatorContext,
    input: ReplaceLotteryRedemptionInput,
  ): Promise<{
    revoked: LotteryRedemptionModel;
    item: LotteryRedemptionModel;
  }> {
    assertPrize(input.prizeAmount);
    const grant = await this.access.grantOf(operator);
    if (!grant.has(STORE_PERMISSIONS.undoRedeem)) {
      throw forbiddenError(
        `Missing permission ${STORE_PERMISSIONS.undoRedeem}`,
      );
    }
    const row = await this.mustRedemption(operator, input.id);
    const shift = await this.shiftOf(operator, row);
    this.assertRevocable(operator, grant, row, shift);
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.redemptionRevokeReason,
      {
        reasonKey: input.reasonKey ?? null,
        reasonNote: input.reasonNote ?? null,
      },
      LOTTERY_FIELD_CATEGORIES,
    );
    const ticket = await this.resolveTicket(operator, shift.orgId, input.code);
    const replacingSame =
      ticket.gameCode === row.gameCode &&
      ticket.bookNo === row.bookNo &&
      ticket.ticketNo === row.ticketNo;
    if (!replacingSame) {
      await this.assertNotRedeemed(operator, ticket);
    }
    const result = await this.withDuplicateGuard(operator, ticket, () =>
      this.transactions.withTransaction(async () => {
        const current = await this.lockShiftIfOpen(operator, shift);
        const revoked = await this.markRevoked(operator, row, current, reason);
        if (current.closedAt === null) {
          await this.assertDrawerCovers(operator, current, input.prizeAmount);
        }
        const created = await this.insert(operator, current, ticket, {
          rawInput: input.code,
          prizeAmount: input.prizeAmount,
          note: trimmed(input.note),
          replacesId: row._id,
          postCloseOf: current.closedAt === null ? null : current._id,
        });
        await publishStoreBoard(this.realtime, row.tenantId, row.orgId);
        return { revoked, created };
      }),
    );
    const [revokedModel, itemModel] = await this.views.toModels(
      operator,
      [result.revoked, result.created],
      grant,
    );
    if (revokedModel === undefined || itemModel === undefined) {
      throw notFoundError("redemption not found");
    }
    return { revoked: revokedModel, item: itemModel };
  }

  // ---- 內部 ----

  /**
   * 編號 → 那一張:背面編號帶遊戲代號;正面編號 / 條碼只有本號 + 張號,用本店持有的張對到唯一的遊戲
   * (對不到或兩款以上 → 請刷背面編號)。本店的張 = 這家店持有的那一張(`ticketId`),其他為 null。
   */
  private async resolveTicket(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    code: string,
  ): Promise<ResolvedTicket> {
    const org = await this.orgs.findById(operator, orgId);
    if (org === null) {
      throw notFoundError(`org not found: ${String(orgId)}`);
    }
    const parsed = parseTicketInput(code);
    if (parsed === null) {
      throw validationError(
        "not a ticket code",
        ["code"],
        REDEMPTION_REASONS.codeInvalid,
      );
    }
    let gameCode = parsed.gameCode ?? null;
    if (gameCode === null) {
      const candidates = await this.tickets.findMany(
        operator,
        { orgId, bookNo: parsed.bookNo, ticketNo: parsed.ticketNo },
        { select: "ticketKey" },
      );
      const codes = [
        ...new Set(
          candidates.map((ticket) => ticket.ticketKey.split("-", 1)[0]),
        ),
      ];
      if (codes.length !== 1 || codes[0] === undefined) {
        throw validationError(
          "scan the back code",
          ["code"],
          REDEMPTION_REASONS.codeNeedsBack,
        );
      }
      gameCode = codes[0];
    }
    const [game, ticket] = await Promise.all([
      this.games.findOne(operator, { gameCode }),
      this.tickets.findOne(
        operator,
        {
          orgId,
          ticketKey: ticketKeyOf(gameCode, parsed.bookNo, parsed.ticketNo),
        },
        { select: "_id" },
      ),
    ]);
    return {
      tenantId: tenantIdOfOrg({ _id: org._id, ancestors: org.ancestors }),
      gameCode,
      gameId: game?._id ?? null,
      gameName: game?.name ?? null,
      unitPrice: game?.unitPrice ?? null,
      bookNo: parsed.bookNo,
      ticketNo: parsed.ticketNo,
      ticketLabel: displayTicketKey(gameCode, parsed.bookNo, parsed.ticketNo),
      ticketId: ticket?._id ?? null,
    };
  }

  /** 這張還沒撤銷的兌獎(整個租戶;別家店兌過也算,反查)。 */
  private async activeOf(
    operator: OperatorContext,
    ticket: ResolvedTicket,
  ): Promise<{ redeemedAt: Date; cashPointName: string } | null> {
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      ticket.tenantId,
    );
    const found = await this.redemptions.findOne(reader, {
      gameCode: ticket.gameCode,
      bookNo: ticket.bookNo,
      ticketNo: ticket.ticketNo,
      revokedAt: null,
    });
    if (found === null) {
      return null;
    }
    const point = await this.cashPoints.findById(reader, found.cashPointId);
    return { redeemedAt: found.redeemedAt, cashPointName: point?.name ?? "" };
  }

  private async assertNotRedeemed(
    operator: OperatorContext,
    ticket: ResolvedTicket,
  ): Promise<void> {
    const existing = await this.activeOf(operator, ticket);
    if (existing !== null) {
      throw duplicateError(existing);
    }
  }

  /** 部分唯一索引擋下同時兌同一張的後到者:交易回復後查出那一筆,回同一個錯誤。 */
  private async withDuplicateGuard<T>(
    operator: OperatorContext,
    ticket: ResolvedTicket,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const existing = await this.activeOf(operator, ticket);
      throw duplicateError(
        existing ?? { redeemedAt: new Date(), cashPointName: "" },
      );
    }
  }

  private async insert(
    operator: OperatorContext,
    shift: ShiftRecord,
    ticket: ResolvedTicket,
    data: {
      rawInput: string;
      prizeAmount: number;
      note: string | null;
      replacesId: Types.ObjectId | null;
      postCloseOf: Types.ObjectId | null;
    },
  ): Promise<RedemptionRecord> {
    if (operator.actorId === null) {
      throw forbiddenError("redemption needs an operator");
    }
    // 單號 `RD-0001`:在同一個交易內取號(交易回復就連號碼一起回復);撤銷不收回,[撤銷並重新登記] 的新紀錄取新號
    const serialNo = await this.serials.next(
      operator,
      REDEMPTION_SERIAL_KEY,
      REDEMPTION_SERIAL_FORMAT,
      { orgId: shift.orgId },
    );
    return this.redemptions.create(operator, {
      serialNo,
      orgId: shift.orgId,
      shiftId: shift._id,
      cashPointId: shift.cashPointId,
      redeemedAt: new Date(),
      redeemedBy: operator.actorId,
      gameCode: ticket.gameCode,
      bookNo: ticket.bookNo,
      ticketNo: ticket.ticketNo,
      ticketLabel: ticket.ticketLabel,
      rawInput: data.rawInput.trim(),
      ticketId: ticket.ticketId,
      gameId: ticket.gameId,
      prizeAmount: data.prizeAmount,
      status: REDEMPTION_STATUS.inStore,
      purchaseSubmissionId: null,
      sentAt: null,
      revokedAt: null,
      revokedBy: null,
      revokeReasonKey: null,
      revokeReason: null,
      revokeNote: null,
      replacesId: data.replacesId,
      postCloseOf: data.postCloseOf,
      revokePostCloseOf: null,
      note: data.note,
      version: 0,
    });
  }

  /** 撤銷方式;沒有權限 → FORBIDDEN;已送兌 / 已撤銷 → VALIDATION_FAILED。 */
  private assertRevocable(
    operator: OperatorContext,
    grant: StoreGrant,
    row: RedemptionRecord,
    shift: ShiftRecord,
  ): "self" | "manager" {
    if (row.status === REDEMPTION_STATUS.revoked) {
      throw validationError(
        "already revoked",
        ["id"],
        REDEMPTION_REASONS.alreadyRevoked,
      );
    }
    const state = redemptionRevokeStateOf({
      status: isRedemptionStatus(row.status)
        ? row.status
        : REDEMPTION_STATUS.inStore,
      isMine:
        operator.actorId !== null && row.redeemedBy.equals(operator.actorId),
      shiftOpen: shift.closedAt === null,
      canRedeem: grant.has(STORE_PERMISSIONS.redeem),
      canUndoRedeem: grant.has(STORE_PERMISSIONS.undoRedeem),
    });
    if (state.mode === null) {
      throw forbiddenError(
        `Missing permission ${STORE_PERMISSIONS.undoRedeem}`,
      );
    }
    if (row.status === REDEMPTION_STATUS.sent) {
      throw validationError(
        "sent redemptions cannot be revoked; withdraw or return the purchase first",
        ["id"],
        REDEMPTION_REASONS.sent,
      );
    }
    return state.mode;
  }

  /** 條件更新(店內持有 + 版本):兩人同時撤銷只有一個成功;班已結帳 → 記事後更正。 */
  private async markRevoked(
    operator: OperatorContext,
    row: RedemptionRecord,
    shift: ShiftRecord,
    reason: {
      reasonKey: string;
      reasonLabel: string;
      reasonNote: string | null;
    } | null,
  ): Promise<RedemptionRecord> {
    const next = await this.redemptions.findOneAndUpdate(
      operator,
      {
        _id: row._id,
        status: REDEMPTION_STATUS.inStore,
        version: row.version,
      },
      {
        $set: {
          status: REDEMPTION_STATUS.revoked,
          revokedAt: new Date(),
          revokedBy: operator.actorId,
          revokeReasonKey:
            reason === null
              ? REDEMPTION_IMMEDIATE_REVOKE_REASON
              : reason.reasonKey,
          revokeReason: reason === null ? null : reason.reasonLabel,
          revokeNote: reason === null ? null : reason.reasonNote,
          revokePostCloseOf: shift.closedAt === null ? null : shift._id,
        },
        $inc: { version: 1 },
      },
    );
    if (next === null) {
      const latest = await this.redemptions.findById(operator, row._id);
      throw latest?.status === REDEMPTION_STATUS.sent
        ? validationError(
            "sent redemptions cannot be revoked",
            ["id"],
            REDEMPTION_REASONS.sent,
          )
        : validationError(
            "already revoked",
            ["id"],
            REDEMPTION_REASONS.alreadyRevoked,
          );
    }
    await this.audit.record(operator, {
      action: REDEMPTION_AUDIT.revoke,
      targetType: REDEMPTION_AUDIT.target,
      targetId: row._id,
      before: { status: row.status, prizeAmount: row.prizeAmount },
      after: {
        status: REDEMPTION_STATUS.revoked,
        reasonKey: next.revokeReasonKey,
        reasonNote: next.revokeNote,
        postCloseOf:
          next.revokePostCloseOf === null
            ? null
            : String(next.revokePostCloseOf),
      },
    });
    return next;
  }

  private async assertDrawerCovers(
    operator: OperatorContext,
    shift: ShiftRecord,
    amount: number,
  ): Promise<void> {
    const expected = await expectedDrawerCash(operator, shift);
    if (amount > expected) {
      throw validationError(
        "prize exceeds the drawer's expected cash",
        ["prizeAmount"],
        REDEMPTION_REASONS.amountExceedsDrawer,
        { expected },
      );
    }
  }

  /** 班要開著;抽屜版本 +1(同投庫 / 出庫)。 */
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
        REDEMPTION_REASONS.shiftClosed,
      );
    }
    return locked;
  }

  /** 班開著 → 抽屜版本 +1;已結帳(或剛好在這時結帳)→ 讀最新的班(撤銷記事後更正)。 */
  private async lockShiftIfOpen(
    operator: OperatorContext,
    shift: ShiftRecord,
  ): Promise<ShiftRecord> {
    const locked = await this.shifts.findOneAndUpdate(
      operator,
      { _id: shift._id, closedAt: null },
      { $inc: { drawerVersion: 1 } },
    );
    if (locked !== null) {
      return locked;
    }
    const latest = await this.shifts.findById(operator, shift._id);
    if (latest === null) {
      throw notFoundError("shift not found");
    }
    return latest;
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

  private async shiftOf(
    operator: OperatorContext,
    row: RedemptionRecord,
  ): Promise<ShiftRecord> {
    const shift = await this.shifts.findById(operator, row.shiftId);
    if (shift === null) {
      throw notFoundError("shift not found");
    }
    return shift;
  }

  private async mustRedemption(
    operator: OperatorContext,
    idText: string,
  ): Promise<RedemptionRecord> {
    const id = parseId(idText);
    const row =
      id === null ? null : await this.redemptions.findById(operator, id);
    if (row === null) {
      throw notFoundError(`redemption not found: ${idText}`);
    }
    return row;
  }

  private async modelOf(
    operator: OperatorContext,
    row: RedemptionRecord,
  ): Promise<LotteryRedemptionModel> {
    const grant = await this.access.grantOf(operator);
    const [model] = await this.views.toModels(operator, [row], grant);
    if (model === undefined) {
      throw notFoundError("redemption not found");
    }
    return model;
  }
}

function duplicateError(existing: { redeemedAt: Date; cashPointName: string }) {
  return validationError(
    "this ticket has been redeemed",
    ["code"],
    REDEMPTION_REASONS.duplicate,
    {
      redeemedAt: existing.redeemedAt.toISOString(),
      cashPointName: existing.cashPointName,
    },
  );
}
