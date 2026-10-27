import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

import {
  BaseRepository,
  type RepositoryModel,
} from "../../../database/base.repository";
import { LotteryAllocation } from "./lottery-allocation.schema";
import { LotteryBook } from "./lottery-book.schema";
import { LotteryTicketEvent } from "./lottery-ticket-event.schema";
import { LotteryTicket } from "./lottery-ticket.schema";

export type LotteryBookDocument = HydratedDocument<LotteryBook>;
export type LotteryTicketDocument = HydratedDocument<LotteryTicket>;
export type LotteryTicketEventDocument = HydratedDocument<LotteryTicketEvent>;
export type LotteryAllocationDocument = HydratedDocument<LotteryAllocation>;

/** lottery_books(本,專案規格 7.1)。 */
@Injectable()
export class LotteryBooksRepository extends BaseRepository<
  LotteryBook,
  LotteryBookDocument
> {
  constructor(
    @InjectModel(LotteryBook.name)
    model: RepositoryModel<LotteryBook, LotteryBookDocument>,
  ) {
    super(model);
  }
}

/** lottery_tickets(張,專案規格 7.1)。 */
@Injectable()
export class LotteryTicketsRepository extends BaseRepository<
  LotteryTicket,
  LotteryTicketDocument
> {
  constructor(
    @InjectModel(LotteryTicket.name)
    model: RepositoryModel<LotteryTicket, LotteryTicketDocument>,
  ) {
    super(model);
  }
}

/** lottery_ticket_events(張數事件,只新增,專案規格 7.2)。 */
@Injectable()
export class LotteryTicketEventsRepository extends BaseRepository<
  LotteryTicketEvent,
  LotteryTicketEventDocument
> {
  constructor(
    @InjectModel(LotteryTicketEvent.name)
    model: RepositoryModel<LotteryTicketEvent, LotteryTicketEventDocument>,
  ) {
    super(model);
  }
}

/** lottery_allocations(預計要給本數,專案規格 7.6)。 */
@Injectable()
export class LotteryAllocationsRepository extends BaseRepository<
  LotteryAllocation,
  LotteryAllocationDocument
> {
  constructor(
    @InjectModel(LotteryAllocation.name)
    model: RepositoryModel<LotteryAllocation, LotteryAllocationDocument>,
  ) {
    super(model);
  }
}
