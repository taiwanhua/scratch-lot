import type { DatabaseRegistration } from "../../../database/registration";
import {
  LOTTERY_ALLOCATIONS_COLLECTION,
  LotteryAllocation,
  LotteryAllocationSchema,
} from "./lottery-allocation.schema";
import {
  LOTTERY_BOOKS_COLLECTION,
  LotteryBook,
  LotteryBookSchema,
} from "./lottery-book.schema";
import {
  LotteryAllocationsRepository,
  LotteryBooksRepository,
  LotteryStoreOpeningsRepository,
  LotteryTicketEventsRepository,
  LotteryTicketsRepository,
} from "./lottery-inventory.repository";
import {
  LOTTERY_STORE_OPENINGS_COLLECTION,
  LotteryStoreOpening,
  LotteryStoreOpeningSchema,
} from "./lottery-store-opening.schema";
import {
  LOTTERY_TICKET_EVENTS_COLLECTION,
  LotteryTicketEvent,
  LotteryTicketEventSchema,
} from "./lottery-ticket-event.schema";
import {
  LOTTERY_TICKETS_COLLECTION,
  LotteryTicket,
  LotteryTicketSchema,
} from "./lottery-ticket.schema";

/** 張數帳本的資料登記:本、張、張數事件、預計要給本數四張模組資料表、分店期初建檔狀態與各自的組織歸屬檢查。 */
export const LOTTERY_INVENTORY_REGISTRATION: DatabaseRegistration = {
  key: "lottery-inventory",
  models: [
    {
      name: LotteryBook.name,
      collection: LOTTERY_BOOKS_COLLECTION,
      schema: LotteryBookSchema,
    },
    {
      name: LotteryTicket.name,
      collection: LOTTERY_TICKETS_COLLECTION,
      schema: LotteryTicketSchema,
    },
    {
      name: LotteryTicketEvent.name,
      collection: LOTTERY_TICKET_EVENTS_COLLECTION,
      schema: LotteryTicketEventSchema,
    },
    {
      name: LotteryAllocation.name,
      collection: LOTTERY_ALLOCATIONS_COLLECTION,
      schema: LotteryAllocationSchema,
    },
    {
      name: LotteryStoreOpening.name,
      collection: LOTTERY_STORE_OPENINGS_COLLECTION,
      schema: LotteryStoreOpeningSchema,
    },
  ],
  repositories: [
    { modelName: LotteryBook.name, provider: LotteryBooksRepository },
    { modelName: LotteryTicket.name, provider: LotteryTicketsRepository },
    {
      modelName: LotteryTicketEvent.name,
      provider: LotteryTicketEventsRepository,
    },
    {
      modelName: LotteryAllocation.name,
      provider: LotteryAllocationsRepository,
    },
    {
      modelName: LotteryStoreOpening.name,
      provider: LotteryStoreOpeningsRepository,
    },
  ],
  orgDataChecks: [
    {
      key: "lottery-books",
      modelName: LotteryBook.name,
      repository: LotteryBooksRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-tickets",
      modelName: LotteryTicket.name,
      repository: LotteryTicketsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-ticket-events",
      modelName: LotteryTicketEvent.name,
      repository: LotteryTicketEventsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-allocations",
      modelName: LotteryAllocation.name,
      repository: LotteryAllocationsRepository,
      ownerField: "orgId",
    },
    {
      key: "lottery-store-openings",
      modelName: LotteryStoreOpening.name,
      repository: LotteryStoreOpeningsRepository,
      ownerField: "orgId",
    },
  ],
};
