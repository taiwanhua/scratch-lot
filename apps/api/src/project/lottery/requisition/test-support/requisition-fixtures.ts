import { type Connection, Types } from "mongoose";

import { MASTER_DATA_MODULE_KEY } from "../../../database/lottery-games/lottery-game.schema";

/**
 * 叫貨單測試的夾具。api 測試的資料庫只種底座(`BASE_ONLY_REGISTRY`),叫貨與進貨的模組與權限、
 * 遊戲與張數帳本的資料由這裡直接寫進**隔離的測試資料庫**(形狀同 seed:`seeds/project/purchasing.ts`;
 * 先例 `project/schedule/test-support/fixtures.ts`)。
 */

export const REQUISITION_PERMISSIONS = {
  view: "purchasing.requisition.view",
  create: "purchasing.requisition.create",
  edit: "purchasing.requisition.edit",
  delete: "purchasing.requisition.delete",
  purchaseList: "purchasing.requisition.purchase-list",
} as const;

export const PURCHASING_MODULE_KEYS = [
  "purchasing",
  "purchasing.requisition",
] as const;

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

/** 寫入叫貨與進貨群組、叫貨、採購單(表單模組)與它的權限。 */
export async function seedPurchasingAuthorization(
  connection: Connection,
): Promise<void> {
  const now = new Date();
  const { insertedId: groupId } = await connection
    .collection("modules")
    .insertOne({
      key: "purchasing",
      name: "叫貨與進貨",
      parentId: null,
      ancestors: [],
      route: "purchasing",
      sidebarType: "group",
      order: 930,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: "fixed",
      ...baseFields(now),
    });
  const { insertedId: moduleId } = await connection
    .collection("modules")
    .insertOne({
      key: "purchasing.requisition",
      name: "叫貨、採購單",
      parentId: groupId,
      ancestors: [groupId],
      route: "requisition",
      sidebarType: "link",
      order: 1,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: "form",
      ...baseFields(now),
    });
  await connection.collection("permissions").insertMany(
    Object.values(REQUISITION_PERMISSIONS).map((key) => ({
      key,
      moduleId,
      name: key,
      enabled: true,
      isSystem: false,
      settings: {},
      source: "seed",
      retiredAt: null,
      ...baseFields(now),
    })),
  );
}

export interface GameInsert {
  gameCode: string;
  name: string;
  status?: "on_sale" | "discontinued";
  unitPrice?: number;
  ticketsPerBook?: number;
  defaultRate?: number;
  launchedAt?: Date | null;
}

/** 遊戲(租戶頂層建、共用給全部分店;形狀同 `lottery_games`)。 */
export async function insertGame(
  connection: Connection,
  tenantId: Types.ObjectId,
  game: GameInsert,
): Promise<Types.ObjectId> {
  const now = new Date();
  const unitPrice = game.unitPrice ?? 200;
  const ticketsPerBook = game.ticketsPerBook ?? 100;
  const { insertedId } = await connection
    .collection("lottery_games")
    .insertOne({
      gameCode: game.gameCode,
      name: game.name,
      status: game.status ?? "on_sale",
      unitPrice,
      ticketsPerBook,
      bookPrice: unitPrice * ticketsPerBook,
      defaultRate: game.defaultRate ?? 92,
      color: null,
      launchedAt: game.launchedAt ?? null,
      discontinuedAt: null,
      claimDeadline: null,
      note: null,
      orgId: tenantId,
      tenantId,
      shareOrgs: [{ orgId: tenantId, includeDescendants: true }],
      moduleKey: MASTER_DATA_MODULE_KEY,
      ...baseFields(now),
    });
  return insertedId;
}

/** 某家店某個遊戲在庫存裡的未售張數(只放「目前庫存」要讀的欄位)。 */
export async function insertStockTickets(
  connection: Connection,
  tenantId: Types.ObjectId,
  orgId: Types.ObjectId,
  gameId: Types.ObjectId,
  count: number,
  location: "stock" | "counter" | "in_transit" = "stock",
): Promise<void> {
  const now = new Date();
  const bookId = new Types.ObjectId();
  await connection.collection("lottery_tickets").insertMany(
    Array.from({ length: count }, (_, index) => ({
      orgId,
      gameId,
      bookId,
      bookNo: "000001",
      ticketNo: String(index + 1).padStart(3, "0"),
      ticketKey: `${String(gameId)}-${String(index)}-${location}`,
      status: "unsold",
      location: { kind: location, cashPointId: null },
      lockedBy: null,
      responsibleOrgId: null,
      unitCost: 184,
      version: 1,
      tenantId,
      moduleKey: "inventory",
      ...baseFields(now),
    })),
  );
}

let eventSequence = 0;

/** 一筆售出 / 撤銷事件(只放近 7 / 30 天要讀的欄位)。 */
export async function insertSaleEvent(
  connection: Connection,
  tenantId: Types.ObjectId,
  orgId: Types.ObjectId,
  gameId: Types.ObjectId,
  at: Date,
  type: "sale" | "sale_stocktake" | "sale_undo" = "sale",
): Promise<void> {
  eventSequence += 1;
  await connection.collection("lottery_ticket_events").insertOne({
    orgId,
    eventId: `requisition-test:${String(eventSequence)}`,
    ticketId: gameId,
    bookId: gameId,
    gameId,
    at,
    by: null,
    type,
    from: null,
    to: {},
    quantity: 1,
    amount: 200,
    cashEffect: "none",
    tenantId,
    moduleKey: "inventory",
    ...baseFields(at),
  });
}
