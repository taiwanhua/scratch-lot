import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  COUNT_MODE,
  COUNT_SALE_REF_TYPE,
  type CountPickBook,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  countSaleLinesProblemOf,
  pickForCountSale,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";

import type { OperatorContext } from "../../../database/operator-context";
import { TransactionService } from "../../../database/transaction";
import { FieldOptionsService } from "../../../fields/field-options.service";
import {
  LotteryBooksRepository,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import { LOTTERY_FIELD_CATEGORIES } from "../field-options/lottery-field-options";
import { TicketLedgerService } from "../tickets/ticket-ledger.service";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import type { SellLotteryTicketsByCountInput } from "./dto/lottery-store-sales.input";
import type { LotteryStoreCountSaleModel } from "./models/lottery-store-sales.model";
import { parseId } from "./shift-views";
import { StoreClock } from "./store-clock";
import { validationError } from "./store-error";
import { StoreMatching } from "./store-matching";
import {
  countSaleInvalidError,
  countSaleNotAllowedError,
  localShiftNotOpenError,
} from "./store-sales-error";
import { StoreSalesSupport } from "./store-sales-support";

/**
 * 一次依張數賣的 id(`refType: count_sale` 的 `refId`):ObjectId 的時間 = 售出時間(秒),撤銷時以
 * `{ orgId, at }` 索引找回這一次的售出事件(規格 5.2「事件表不加索引」)。
 */
export function countSaleRefIdAt(at: Date): Types.ObjectId {
  return new Types.ObjectId(
    Types.ObjectId.generate(Math.floor(at.getTime() / 1000)),
  );
}

/**
 * 依張數標記售出(張數店規格 7.2、13.1、14.2 `sellLotteryTicketsByCount`):只有張數店可用(轉換中、編號店擋下);
 * 鎖本機收銀點那一班的抽屜,每個遊戲照挑張順序(`pickForCountSale`)挑這台未售、沒被鎖的張,每張一筆「售出」
 * (`to.unmatched`、`soldSource: count`、`refType: count_sale`,每個遊戲各一個 `refId`),當下算這一班的現金。
 * 一次送出、同一個交易;候選張、本、遊戲各讀一次(TX-06)。
 */
@Injectable()
export class StoreCountSalesService {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly books: LotteryBooksRepository,
    private readonly ledger: TicketLedgerService,
    private readonly fieldOptions: FieldOptionsService,
    private readonly transactions: TransactionService,
    private readonly support: StoreSalesSupport,
    private readonly matching: StoreMatching,
    private readonly clock: StoreClock,
  ) {}

  async sellByCount(
    operator: OperatorContext,
    input: SellLotteryTicketsByCountInput,
  ): Promise<LotteryStoreCountSaleModel[]> {
    const store = await this.support.mustStore(operator, input.orgId);
    const local = await this.support.mustCashPoint(
      operator,
      store.orgId,
      input.localCashPointId,
      "localCashPointId",
    );
    const mode = await this.matching.modeOf(operator, store.orgId);
    if (mode !== COUNT_MODE.count) {
      throw countSaleNotAllowedError(mode);
    }
    const lines = input.lines.map((line) => {
      const gameId = parseId(line.gameId);
      if (gameId === null) {
        throw validationError("invalid game id", ["lines"]);
      }
      return { gameId, count: line.count };
    });
    const reason = await this.fieldOptions.assertReason(
      operator,
      LOTTERY_FIELD_CATEGORY_KEYS.countSaleReason,
      {
        reasonKey: input.reasonKey ?? null,
        reasonNote: input.reasonNote ?? null,
      },
      LOTTERY_FIELD_CATEGORIES,
    );
    const games = await this.support.gamesOf(
      operator,
      lines.map((line) => line.gameId),
    );
    const result = await this.transactions.withTransaction(async (session) => {
      const now = this.clock.now();
      const openShifts = await this.support.openShiftsOf(
        operator,
        store.orgId,
        session,
      );
      const shift = openShifts.get(String(local._id));
      if (shift === undefined) {
        throw localShiftNotOpenError();
      }
      if ((await this.support.lockDrawer(operator, shift._id)) === null) {
        throw localShiftNotOpenError();
      }
      const found = await this.tickets.findMany(
        operator,
        {
          orgId: store.orgId,
          gameId: { $in: lines.map((line) => line.gameId) },
          "location.kind": TICKET_LOCATION_KIND.counter,
          "location.cashPointId": local._id,
          status: TICKET_STATUS.unsold,
          lockedBy: null,
        },
        { session },
      );
      const bookRows = await this.books.findMany(
        operator,
        { _id: { $in: [...new Set(found.map((ticket) => ticket.bookId))] } },
        { session, select: "bookNo firstOpenedAt" },
      );
      const books = new Map<string, CountPickBook>(
        bookRows.map((book) => [
          String(book._id),
          { bookNo: book.bookNo, firstOpenedAt: book.firstOpenedAt ?? null },
        ]),
      );
      const available = new Map<string, number>();
      for (const ticket of found) {
        const key = String(ticket.gameId);
        available.set(key, (available.get(key) ?? 0) + 1);
      }
      const problem = countSaleLinesProblemOf(
        lines.map((line) => ({
          gameId: String(line.gameId),
          count: line.count,
        })),
        available,
      );
      if (problem !== null) {
        throw countSaleInvalidError(problem);
      }
      const byId = new Map(found.map((ticket) => [String(ticket._id), ticket]));
      const events: TicketEventInput[] = [];
      const items: LotteryStoreCountSaleModel[] = [];
      for (const line of lines) {
        const game = games.get(String(line.gameId));
        if (game === undefined) {
          throw countSaleInvalidError({
            kind: "exceeds",
            gameId: String(line.gameId),
            available: 0,
          });
        }
        const picked = pickForCountSale(
          found
            .filter((ticket) => ticket.gameId.equals(line.gameId))
            .map((ticket) => ({
              id: String(ticket._id),
              bookId: String(ticket.bookId),
              ticketNo: ticket.ticketNo,
              status: ticket.status,
              locked: ticket.lockedBy !== null,
            })),
          books,
          line.count,
        );
        if (!picked.ok) {
          throw countSaleInvalidError({
            kind: "exceeds",
            gameId: String(line.gameId),
            available: picked.available,
          });
        }
        const refId = countSaleRefIdAt(now);
        for (const id of picked.ticketIds) {
          const ticket = byId.get(id);
          if (ticket === undefined) {
            continue;
          }
          events.push({
            ticketId: ticket._id,
            expectedVersion: ticket.version,
            expectedStatuses: [TICKET_STATUS.unsold],
            type: TICKET_EVENT_TYPE.sale,
            at: now,
            patch: {
              status: TICKET_STATUS.sold,
              sold: { at: now, source: "count" },
              unmatched: true,
            },
            amount: game.unitPrice,
            cashEffect: "increase",
            cashPointId: local._id,
            shiftId: shift._id,
            refType: COUNT_SALE_REF_TYPE,
            refId,
            reasonKey: reason.reasonKey,
            reasonNote: reason.reasonNote,
          });
        }
        items.push({
          refId: String(refId),
          gameId: String(game._id),
          gameCode: game.gameCode,
          gameName: game.name,
          unitPrice: game.unitPrice,
          count: line.count,
          amount: game.unitPrice * line.count,
        });
      }
      await this.ledger.applyTicketEvents(session, { operator }, events);
      await this.support.publish(store);
      return items;
    });
    return result;
  }
}
