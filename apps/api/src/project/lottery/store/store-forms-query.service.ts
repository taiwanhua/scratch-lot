import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  CASH_CORRECTION_FORM_KEY,
  CASH_CORRECTION_PLACE,
  SALE_REVERSAL_FORM_KEY,
  STORE_KEY,
  TICKET_STATUS,
  cashCorrectionValuesOf,
  formatTicketRanges,
  saleReversalValuesOf,
  signedCorrectionAmount,
} from "@repo/domain/project/lottery";

import { FormSubmissionsRepository } from "../../../database/base/repositories";
import type { OperatorContext } from "../../../database/operator-context";
import type { FormSubmissionStatusEnum } from "../../../forms/form-runtime/models/form-submission.model";
import { LotteryGamesRepository } from "../../database/lottery-games/lottery-games.repository";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LotteryShiftsRepository } from "../../database/lottery-store/lottery-shifts.repository";
import type {
  LotteryStoreCashCorrectionRowModel,
  LotteryStoreSaleReversalOptionsModel,
  LotteryStoreSaleReversalRowModel,
  LotteryStoreShiftOptionModel,
} from "./models/lottery-store-forms.model";
import { parseId } from "./shift-views";
import { StoreAccess } from "./store-access";
import { StoreMatching } from "./store-matching";
import { StoreSalesSupport } from "./store-sales-support";

/** 列表列出的狀態:送出之後(草稿不算;兩張表單都沒有草稿)。 */
const LISTED_STATUSES = [
  "reviewing",
  "returned",
  "withdrawn",
  "completed",
  "rejected",
  "voided",
] as const;

/** 列表一次最多列幾筆(新的在前)。 */
const LIST_LIMIT = 200;

/** 退款班次可以選的班:這家店最近幾天開過的(開著的一定列)。 */
const SHIFT_OPTION_DAYS = 14;
const SHIFT_OPTION_LIMIT = 100;

/** 審核中的單據對某一班現金的影響(交班精靈自動帶入差額原因;規格 6.9、8.8)。 */
export interface PendingCashImpact {
  submissionId: Types.ObjectId;
  formKey: typeof SALE_REVERSAL_FORM_KEY | typeof CASH_CORRECTION_FORM_KEY;
  serialNo: string | null;
  /** 對那一班抽屜的影響:撤銷售出 −退款金額;現金更正 ±金額。 */
  amount: number;
}

function labelOf(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : "";
}

/** 引用欄位的存值 `{ id, label }`(舊值可能是字串 id)以 id 比對。 */
function referenceIs(fieldKey: string, id: string): Record<string, unknown> {
  return {
    $or: [{ [`values.${fieldKey}.id`]: id }, { [`values.${fieldKey}`]: id }],
  };
}

/**
 * 撤銷售出申請、現金更正單的查詢(規格 8.5、8.8、6.1;正本 `docs/modules/project/store.md`):
 * 分頁列表(ST-31a / ST-32a)、新增頁的退款班次選項、給交班結帳的「審核中的現金影響」。
 * 讀取照操作者的可見範圍;列表要 `store.view`。
 */
@Injectable()
export class StoreFormsQueryService {
  constructor(
    private readonly submissions: FormSubmissionsRepository,
    private readonly shifts: LotteryShiftsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly tickets: LotteryTicketsRepository,
    private readonly games: LotteryGamesRepository,
    private readonly access: StoreAccess,
    private readonly support: StoreSalesSupport,
    private readonly matching: StoreMatching,
  ) {}

  /**
   * 撤銷售出申請新增頁的選項(張數店規格 7.3 第 3 點、13.2;Figma CS-14):這家店的盤點制度、啟用中的收銀點;
   * 給了收銀點時,這台有已售·未對號(沒被單據鎖住)的遊戲與張數(「最多 N 張」;一次 aggregate + $group,
   * 走 { orgId, gameId, location.cashPointId, status, soldAt } 的 partial 索引)。
   */
  async saleReversalOptions(
    operator: OperatorContext,
    orgIdText: string,
    cashPointIdText: string | null,
  ): Promise<LotteryStoreSaleReversalOptionsModel> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const countMode = await this.matching.modeOf(operator, store.orgId);
    const points = await this.support.cashPointsOf(operator, store.orgId);
    const cashPoints = [...points.values()]
      .toSorted((left, right) => left.order - right.order)
      .map((point) => ({ id: String(point._id), name: point.name }));
    const pointId = cashPointIdText === null ? null : parseId(cashPointIdText);
    if (pointId === null || !points.has(String(pointId))) {
      return { countMode, cashPoints, games: [] };
    }
    const grouped = await this.tickets.aggregate(operator, [
      {
        $match: {
          orgId: store.orgId,
          status: TICKET_STATUS.sold,
          unmatched: true,
          "location.cashPointId": pointId,
          lockedBy: null,
        },
      },
      { $group: { _id: "$gameId", available: { $sum: 1 } } },
    ]);
    const rows = grouped.map((row) => ({
      _id: row._id as Types.ObjectId,
      available: Number(row.available),
    }));
    const games =
      rows.length === 0
        ? []
        : await this.games.findMany(operator, {
            _id: { $in: rows.map((row) => row._id) },
          });
    const gameOf = new Map(games.map((game) => [String(game._id), game]));
    return {
      countMode,
      cashPoints,
      games: rows
        .flatMap((row) => {
          const game = gameOf.get(String(row._id));
          return game === undefined
            ? []
            : [
                {
                  gameId: String(game._id),
                  gameCode: game.gameCode,
                  gameName: game.name,
                  unitPrice: game.unitPrice,
                  available: row.available,
                },
              ];
        })
        .toSorted((left, right) => left.gameCode.localeCompare(right.gameCode)),
    };
  }

  /** 這家店可以選的班(新的在前):開著的 + 最近 14 天開過的。 */
  async shiftOptions(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreShiftOptionModel[]> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const since = new Date(Date.now() - SHIFT_OPTION_DAYS * 24 * 3_600_000);
    const rows = await this.shifts.findMany(
      operator,
      {
        orgId: store.orgId,
        $or: [{ closedAt: null }, { openedAt: { $gte: since } }],
      },
      {
        select: "label openedAt closedAt openedBy cashPointId",
        sort: { openedAt: -1 },
        limit: SHIFT_OPTION_LIMIT,
      },
    );
    const points = await this.support.cashPointsOf(operator, store.orgId);
    return rows.map((shift) => ({
      id: String(shift._id),
      label: shift.label,
      openedAt: shift.openedAt,
      open: shift.closedAt === null,
      mine:
        shift.closedAt === null &&
        operator.actorId !== null &&
        shift.openedBy.equals(operator.actorId),
      cashPointPrinterId:
        points.get(String(shift.cashPointId))?.printerId?.toString() ?? null,
    }));
  }

  /** 撤銷售出分頁(ST-31a):這家店的撤銷售出申請。 */
  async saleReversals(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreSaleReversalRowModel[]> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const rows = await this.listOf(
      operator,
      SALE_REVERSAL_FORM_KEY,
      String(store.orgId),
    );
    const bookIds = new Set<string>();
    const gameIds = new Set<string>();
    for (const row of rows) {
      const parsed = saleReversalValuesOf(row.values);
      for (const line of parsed.lines) {
        bookIds.add(line.bookId);
      }
      for (const line of parsed.countLines) {
        if (line.gameId !== null) {
          gameIds.add(line.gameId);
        }
      }
    }
    const books = await this.bookCodesOf(operator, [...bookIds]);
    const games = await this.gameCodesOf(operator, [...gameIds]);
    return rows.map((row) => {
      const values = row.values;
      const parsed = saleReversalValuesOf(values);
      return {
        id: String(row._id),
        serialNo: row.serialNo,
        status: row.status,
        ticketGroups: [
          ...parsed.lines.map((line) =>
            [books.get(line.bookId) ?? "", formatTicketRanges(line.ticketNos)]
              .filter((part) => part !== "")
              .join(" "),
          ),
          // 依遊戲 + 張數(張數店規格 5.7):「5164 × 2」
          ...parsed.countLines.map((line) =>
            [games.get(line.gameId ?? "") ?? "", "× " + String(line.count)]
              .filter((part) => part !== "")
              .join(" "),
          ),
        ],
        ticketCount:
          parsed.lines.reduce((sum, line) => sum + line.ticketNos.length, 0) +
          parsed.countLines.reduce((sum, line) => sum + line.count, 0),
        reasonLabel: labelOf(values.reason),
        refund: parsed.refund,
        refundAmount: parsed.refund ? parsed.refundAmount : 0,
        refundShiftLabel: parsed.refund
          ? labelOf(values.refund_shift) || null
          : null,
        submittedAt: row.submittedAt,
      };
    });
  }

  /** 現金更正分頁(ST-32a):這家店的現金更正單。 */
  async cashCorrections(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<LotteryStoreCashCorrectionRowModel[]> {
    await this.access.assertView(operator);
    const store = await this.support.mustStore(operator, orgIdText);
    const rows = await this.listOf(
      operator,
      CASH_CORRECTION_FORM_KEY,
      String(store.orgId),
    );
    return rows.map((row) => {
      const values = row.values;
      const parsed = cashCorrectionValuesOf(values);
      const place = parsed.place ?? CASH_CORRECTION_PLACE.vault;
      return {
        id: String(row._id),
        serialNo: row.serialNo,
        status: row.status,
        direction: parsed.direction ?? "",
        amount: parsed.amount,
        place,
        placeShiftLabel:
          place === CASH_CORRECTION_PLACE.drawer
            ? labelOf(values.shift) || null
            : null,
        attributedShiftLabel: labelOf(values.attributed_shift) || null,
        reasonLabel: labelOf(values.reason),
        submittedAt: row.submittedAt,
      };
    });
  }

  /**
   * **給交班結帳(P26)的查詢** `pendingCashImpacts(shiftId)`:審核中的現金更正單(位置 = 這一班)與
   * 撤銷售出申請(退款 = 是、退款班次 = 這一班),交班精靈第 ③ 步列出並自動帶入差額原因(規格 6.9、8.8)。
   */
  async pendingCashImpacts(
    operator: OperatorContext,
    shiftId: Types.ObjectId,
  ): Promise<PendingCashImpact[]> {
    const id = String(shiftId);
    const rows = await this.submissions.findMany(
      operator,
      {
        moduleKey: STORE_KEY,
        status: "reviewing",
        $or: [
          {
            formKey: CASH_CORRECTION_FORM_KEY,
            ...referenceIs("shift", id),
          },
          {
            formKey: SALE_REVERSAL_FORM_KEY,
            ...referenceIs("refund_shift", id),
          },
        ],
      },
      { sort: { submittedAt: 1 } },
    );
    return rows.flatMap((row): PendingCashImpact[] => {
      if (row.formKey === CASH_CORRECTION_FORM_KEY) {
        const parsed = cashCorrectionValuesOf(row.values);
        if (
          parsed.place !== CASH_CORRECTION_PLACE.drawer ||
          parsed.direction === null
        ) {
          return [];
        }
        return [
          {
            submissionId: row._id,
            formKey: CASH_CORRECTION_FORM_KEY,
            serialNo: row.serialNo,
            amount: signedCorrectionAmount(parsed.direction, parsed.amount),
          },
        ];
      }
      const parsed = saleReversalValuesOf(row.values);
      return parsed.refund
        ? [
            {
              submissionId: row._id,
              formKey: SALE_REVERSAL_FORM_KEY,
              serialNo: row.serialNo,
              amount: -parsed.refundAmount,
            },
          ]
        : [];
    });
  }

  private async listOf(
    operator: OperatorContext,
    formKey: string,
    orgId: string,
  ) {
    const rows = await this.submissions.findMany(
      operator,
      {
        moduleKey: STORE_KEY,
        formKey,
        status: { $in: [...LISTED_STATUSES] },
        ...referenceIs("branch", orgId),
      },
      { sort: { submittedAt: -1, createdAt: -1 }, limit: LIST_LIMIT },
    );
    return rows.map((row) => ({
      _id: row._id,
      serialNo: row.serialNo,
      // 存值的狀態字串 = GraphQL 列舉的值(`FormSubmissionStatusEnum`)
      status: row.status as FormSubmissionStatusEnum,
      submittedAt: row.submittedAt,
      values: row.values,
    }));
  }

  /** 遊戲 id → 遊戲代號(列表的「5164 × 2」)。 */
  private async gameCodesOf(
    operator: OperatorContext,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const objectIds = ids.flatMap((id) => {
      const parsed = parseId(id);
      return parsed === null ? [] : [parsed];
    });
    if (objectIds.length === 0) {
      return new Map();
    }
    const rows = await this.games.findMany(
      operator,
      { _id: { $in: objectIds } },
      { select: "gameCode" },
    );
    return new Map(rows.map((game) => [String(game._id), game.gameCode]));
  }

  /** 本 id → 遊戲代號(列表的「5164 #031–032」)。 */
  private async bookCodesOf(
    operator: OperatorContext,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const objectIds = ids.flatMap((id) => {
      const parsed = parseId(id);
      return parsed === null ? [] : [parsed];
    });
    if (objectIds.length === 0) {
      return new Map();
    }
    const rows = await this.books.findMany(
      operator,
      { _id: { $in: objectIds } },
      { select: "gameCode" },
    );
    return new Map(rows.map((book) => [String(book._id), book.gameCode]));
  }
}
