import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  STOCKTAKE_DIFF_ACTION,
  TICKET_EVENT_TYPE,
  TICKET_LOCATION_KIND,
  TICKET_STATUS,
  type TicketStatus,
} from "@repo/domain/project/lottery";

import type { Persisted } from "../../../database/base.repository";
import type { OperatorContext } from "../../../database/operator-context";
import {
  type LotteryTicketDocument,
  LotteryTicketsRepository,
} from "../../database/lottery-inventory/lottery-inventory.repository";
import type {
  StocktakeLine,
  StocktakeRenumber,
  StocktakeRenumberMatch,
} from "../../database/lottery-stocktakes/lottery-stocktake.schema";
import { StoreCountModeService } from "../settings/store-count-mode.service";
import { matchEventsOf, ticketCopyOf } from "../store/store-matching";
import type { TicketEventInput } from "../tickets/ticket-ledger.types";
import {
  type LineEvaluation,
  StocktakeFacts,
  renumberOfEvaluations,
} from "./stocktake-facts";

type TicketRecord = Persisted<LotteryTicketDocument>;

const REF_TYPE = "stocktake";

const GUESS_STATUSES: ReadonlySet<TicketStatus> = new Set([
  TICKET_STATUS.sold,
  TICKET_STATUS.investigating,
  TICKET_STATUS.lost,
]);

/** 補點編號的盤點單(核准時要用的欄位)。 */
export interface RenumberStocktakeRecord {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  startedAt: Date;
  lines: readonly StocktakeLine[];
  renumber: StocktakeRenumber | null;
}

/** 一行的位置 key(和 `renumberOfEvaluations` 同一個:收銀點 id;庫存 = `stock`)。 */
const placeOf = (cashPointId: Types.ObjectId | null): string =>
  cashPointId === null ? "stock" : String(cashPointId);

/**
 * 補點編號(張數店規格 9.3、16.8 RN1–RN3;正本 `docs/modules/project/store.md`「補點編號」):
 *
 * - `resultOf`:送出時的比對結果(自動對號、實際在但沒有配對張的待查 / 遺失·未對號)寫進盤點單 `renumber`
 * - `missingOf`:每本都要盤 —— 還沒盤的本、還沒回答在 / 不在的未拆的本(不能沒盤完送出)
 * - `approvalEvents`:核准時要寫的事件(整批經帳本寫,TX-06):[標跳號]、自動對號兩筆 `match`、沒有配對張的
 *   待查 / 遺失·未對號尋回並留在盤到的位置(6.4)、其餘店內的未對號張每張一筆 `renumber_confirm`;
 *   盤點之後被動過、被鎖住的張不寫(之後的盤點或重刷再處理)
 * - `approve`:寫分店那一筆(上次補點、轉換中 → 編號、歷程)
 */
@Injectable()
export class RenumberStocktake {
  constructor(
    private readonly tickets: LotteryTicketsRepository,
    private readonly facts: StocktakeFacts,
    private readonly countModes: StoreCountModeService,
  ) {}

  /** 送出時的比對結果(遊戲名稱由呼叫端給)。 */
  resultOf(
    evaluations: readonly LineEvaluation[],
    gameNames: ReadonlyMap<string, string>,
  ): StocktakeRenumber {
    const result = renumberOfEvaluations(evaluations);
    const tickets = new Map<
      string,
      {
        ticket: TicketRecord;
        bookNo: string;
        gameCode: string;
        countedAt: Date;
      }
    >();
    for (const item of evaluations) {
      if (item.book === null) {
        continue;
      }
      for (const ticket of item.ticketById.values()) {
        const key = `${String(ticket._id)}@${placeOf(item.cashPointId)}`;
        tickets.set(key, {
          ticket,
          bookNo: item.book.bookNo,
          gameCode: item.book.gameCode,
          countedAt: new Date(item.line.countedAt),
        });
      }
    }
    const matches: StocktakeRenumberMatch[] = result.matches.flatMap(
      (match) => {
        const found = tickets.get(`${match.ticketId}@${match.place}`);
        const partner = tickets.get(`${match.partnerId}@${match.place}`);
        if (found === undefined || partner === undefined) {
          return [];
        }
        return [
          {
            ticketId: found.ticket._id,
            ticketNo: found.ticket.ticketNo,
            bookNo: found.bookNo,
            partnerId: partner.ticket._id,
            partnerTicketNo: partner.ticket.ticketNo,
            partnerBookNo: partner.bookNo,
            gameCode: found.gameCode,
            gameName: gameNames.get(String(found.ticket.gameId)) ?? "",
            cashPointId:
              match.place === "stock" ? null : new Types.ObjectId(match.place),
            // 兩本各自開始盤的時間取早的(核准時那之後有異動就不寫)
            countedAt: new Date(
              Math.min(found.countedAt.getTime(), partner.countedAt.getTime()),
            ),
          },
        ];
      },
    );
    const recovered = [...tickets.values()]
      .filter(
        ({ ticket }) =>
          result.leftoverPresent.includes(String(ticket._id)) &&
          ticket.status !== TICKET_STATUS.sold,
      )
      .map(({ ticket, countedAt }) => ({
        ticketId: ticket._id,
        cashPointId: ticket.location.cashPointId ?? null,
        countedAt,
      }));
    return { matches, recovered };
  }

  /**
   * 還沒盤完的(9.3 第 1 點「每本都要盤,不能沒盤完送出」):範圍內還沒盤的本(檯面、拆過在庫存的本)與
   * 還沒回答在 / 不在的未拆的本。
   */
  missingOf(
    uncountedBookNos: readonly string[],
    unopenedBookIds: readonly string[],
    answeredUnopened: readonly string[],
  ): string[] {
    const answered = new Set(answeredUnopened);
    return [
      ...uncountedBookNos,
      ...unopenedBookIds.filter((id) => !answered.has(id)),
    ];
  }

  /**
   * 核准時要寫的事件(9.3 第 2–4 點;一次讀張、一次讀之後的事件,整批寫)。順序:[標跳號] → 對號 → 尋回 →
   * 猜對了的清記號(對號的配對張接手未對號狀態後也清,用對號後的版本)。
   */
  async approvalEvents(
    reader: OperatorContext,
    record: RenumberStocktakeRecord,
    at: Date,
    session: ClientSession,
  ): Promise<TicketEventInput[]> {
    const renumber = record.renumber ?? { matches: [], recovered: [] };
    const skips = record.lines.flatMap((line) =>
      line.diffs
        .filter((diff) => diff.action === STOCKTAKE_DIFF_ACTION.skip)
        .map((diff) => ({ ticketId: diff.ticketId, after: line.countedAt })),
    );
    const guesses = await this.tickets.findMany(
      reader,
      { orgId: record.orgId, unmatched: true },
      { session },
    );
    const extraIds = [
      ...skips.map((entry) => entry.ticketId),
      ...renumber.matches.flatMap((match) => [match.ticketId, match.partnerId]),
      ...renumber.recovered.map((entry) => entry.ticketId),
    ];
    const known = new Set(guesses.map((ticket) => String(ticket._id)));
    const others = extraIds.filter((id) => !known.has(String(id)));
    const loaded =
      others.length === 0
        ? []
        : await this.tickets.findMany(
            reader,
            { _id: { $in: others }, orgId: record.orgId },
            { session },
          );
    const byId = new Map(
      [...guesses, ...loaded].map((ticket) => [String(ticket._id), ticket]),
    );
    // 盤點之後被動過的張不寫(未對號張一律從開始盤的時間算)
    const changed = await this.facts.changedAfter(
      reader,
      [
        ...skips,
        ...renumber.matches.flatMap((match) => [
          { ticketId: match.ticketId, after: match.countedAt },
          { ticketId: match.partnerId, after: match.countedAt },
        ]),
        ...renumber.recovered.map((entry) => ({
          ticketId: entry.ticketId,
          after: entry.countedAt,
        })),
        ...guesses.map((ticket) => ({
          ticketId: ticket._id,
          after: record.startedAt,
        })),
      ],
      { session },
    );
    const usable = (id: Types.ObjectId): TicketRecord | null => {
      const ticket = byId.get(String(id));
      if (ticket === undefined || changed.has(String(id))) {
        return null;
      }
      return ticket.lockedBy === null ? ticket : null;
    };
    const events: TicketEventInput[] = [];
    const ref = { refType: REF_TYPE, refId: record._id };
    for (const entry of skips) {
      const ticket = usable(entry.ticketId);
      if (ticket?.status === TICKET_STATUS.unsold) {
        events.push({
          ticketId: ticket._id,
          expectedVersion: ticket.version,
          expectedStatuses: [TICKET_STATUS.unsold],
          type: TICKET_EVENT_TYPE.skip,
          at,
          patch: { status: TICKET_STATUS.skipped },
          ...ref,
        });
      }
    }
    // 對號後的配對張:接手未對號狀態(之後清記號用 +1 的版本)
    const afterMatch = new Map<string, TicketRecord>();
    const handled = new Set<string>();
    for (const match of renumber.matches) {
      const ticket = usable(match.ticketId);
      const partner = usable(match.partnerId);
      if (
        ticket === null ||
        partner === null ||
        !ticket.unmatched ||
        !GUESS_STATUSES.has(ticket.status) ||
        partner.status !== TICKET_STATUS.unsold
      ) {
        continue;
      }
      events.push(...matchEventsOf(ticket, partner, at));
      handled.add(String(ticket._id));
      afterMatch.set(
        String(partner._id),
        ticketCopyOf(partner, {
          status: ticket.status,
          unmatched: true,
          version: partner.version + 1,
        }),
      );
    }
    for (const entry of renumber.recovered) {
      const ticket = usable(entry.ticketId);
      if (
        ticket === null ||
        !ticket.unmatched ||
        (ticket.status !== TICKET_STATUS.investigating &&
          ticket.status !== TICKET_STATUS.lost)
      ) {
        continue;
      }
      handled.add(String(ticket._id));
      events.push({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        expectedStatuses: [TICKET_STATUS.investigating, TICKET_STATUS.lost],
        type: TICKET_EVENT_TYPE.recover,
        at,
        // 尋回並留在盤到的位置(6.4、6.3 補點編號 = 正在盤的位置)
        patch: {
          status: TICKET_STATUS.unsold,
          location:
            entry.cashPointId === null
              ? { kind: TICKET_LOCATION_KIND.stock, cashPointId: null }
              : {
                  kind: TICKET_LOCATION_KIND.counter,
                  cashPointId: entry.cashPointId,
                },
          responsibleOrgId: null,
        },
        cashPointId: entry.cashPointId,
        ...ref,
      });
    }
    const confirm = [
      ...guesses.flatMap((ticket) => {
        const current = usable(ticket._id);
        return current === null || handled.has(String(ticket._id))
          ? []
          : [afterMatch.get(String(ticket._id)) ?? current];
      }),
      ...[...afterMatch.values()].filter(
        (ticket) => !known.has(String(ticket._id)),
      ),
    ];
    for (const ticket of confirm) {
      events.push({
        ticketId: ticket._id,
        expectedVersion: ticket.version,
        expectedStatuses: [ticket.status],
        type: TICKET_EVENT_TYPE.renumberConfirm,
        at,
        patch: { unmatched: false },
        ...ref,
      });
    }
    return events;
  }

  /** 核准:寫分店那一筆(上次補點、轉換中 → 編號、歷程;9.3 第 4 點)。 */
  approve(
    writer: OperatorContext,
    record: RenumberStocktakeRecord,
    by: Types.ObjectId | null,
    at: Date,
    session: ClientSession,
  ): Promise<void> {
    return this.countModes.applyRenumberApproval(
      writer,
      record.orgId,
      { stocktakeId: record._id, by, at },
      session,
    );
  }
}
