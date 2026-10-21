import { type Connection, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";

import {
  column,
  definitionOf,
  field,
} from "../../../../forms/test-support/form-fixtures";

/**
 * 進貨單測試的夾具。api 測試的資料庫只種底座,叫貨與進貨的模組與權限、甲類 / 關係人 / 關聯、銀行帳戶、
 * 叫貨明細副本由這裡直接寫進**隔離的測試資料庫**(形狀同 seed 與各自的 schema;先例
 * `requisition/test-support/requisition-fixtures.ts`)。
 */

export const PURCHASE_PERMISSION_KEYS = {
  view: "purchasing.purchase.view",
  create: "purchasing.purchase.create",
  edit: "purchasing.purchase.edit",
  delete: "purchasing.purchase.delete",
  settle: "purchasing.purchase.settle",
} as const;

export const PURCHASE_MODULE_KEYS = [
  "purchasing",
  "purchasing.purchase",
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

/** 叫貨與進貨群組、進貨單(表單模組)與它的權限。 */
export async function seedPurchaseAuthorization(
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
      key: "purchasing.purchase",
      name: "進貨單",
      parentId: groupId,
      ancestors: [groupId],
      route: "purchase",
      sidebarType: "link",
      order: 2,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: "form",
      ...baseFields(now),
    });
  await connection.collection("permissions").insertMany(
    Object.values(PURCHASE_PERMISSION_KEYS).map((key) => ({
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

/** 庫存管理的模組(讀庫存概況用;權限不必,看綁不綁模組)。 */
export async function seedInventoryModule(
  connection: Connection,
): Promise<void> {
  await connection.collection("modules").insertOne({
    key: "inventory",
    name: "庫存管理",
    parentId: null,
    ancestors: [],
    route: "inventory",
    sidebarType: "link",
    order: 20,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    engine: "fixed",
    ...baseFields(new Date()),
  });
}

/** 進貨單的定義(欄位 key 同受管表單 `seeds/project/revisions/purchase.r4.seed.ts`)。 */
export function purchaseDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text"),
    field("branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("requisition", "text"),
    field("dealer", "reference", {
      source: {
        provider: "lottery_dealer",
        labelField: "name",
        filter: { type: "a", status: "active" },
      },
      rules: { required: true },
    }),
    field("self_purchase", "boolean"),
    // r4:本人批購 = 否時必填(本人批購 = 是時隱藏,隱藏欄不檢查)
    field("trustee", "reference", {
      source: {
        provider: "lottery_dealer_contact",
        labelField: "name",
        filter: { status: "active", roles: "trustee" },
      },
      visibleWhen: { "!": [{ var: "self_purchase" }] },
      rules: { required: true },
    }),
    field("purchase_date", "date", { rules: { required: true } }),
    field("account", "reference", {
      source: {
        provider: "lottery_bank_account",
        labelField: "label",
        filter: { status: "active" },
      },
      rules: { required: true },
    }),
    field("lines", "array", {
      columns: [
        column("game", "reference", {
          source: {
            provider: "lottery_game",
            labelField: "name",
            filter: { status: "on_sale" },
          },
          rules: { required: true },
        }),
        column("book_no", "text", { rules: { required: true } }),
        column("last_ticket_no", "number", {
          rules: { required: true, min: 1, max: 999 },
        }),
        column("tickets", "number"),
        column("book_price", "number"),
        column("rate", "number", { rules: { required: true, min: 0 } }),
        column("amount", "number", {
          valueSource: {
            kind: "computed",
            expr: {
              "/": [
                { "*": [{ var: "row.book_price" }, { var: "row.rate" }] },
                100,
              ],
            },
          },
        }),
      ],
      rules: { required: true },
    }),
    field("purchase_total", "number", {
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "amount"] } },
    }),
    field("redemptions", "array", {
      columns: [
        column("redemption", "reference", {
          source: {
            provider: "lottery_redemption",
            labelField: "ticketLabel",
            filter: { status: "in_store" },
          },
          rules: { required: true },
        }),
        column("prize_amount", "number", { rules: { required: true, min: 1 } }),
      ],
    }),
    field("redemption_total", "number", {
      valueSource: {
        kind: "computed",
        expr: { sumOf: ["redemptions", "prize_amount"] },
      },
    }),
    field("redemption_offset", "number", {
      valueSource: {
        kind: "computed",
        expr: { min: [{ var: "redemption_total" }, { var: "purchase_total" }] },
      },
    }),
    field("deducted_amount", "number", {
      valueSource: {
        kind: "computed",
        expr: {
          "-": [{ var: "purchase_total" }, { var: "redemption_offset" }],
        },
      },
    }),
    field("redemption_remainder", "number", {
      valueSource: {
        kind: "computed",
        expr: {
          "-": [{ var: "redemption_total" }, { var: "redemption_offset" }],
        },
      },
    }),
  ]);
}

export interface GameInsert {
  gameCode: string;
  name: string;
  status?: "on_sale" | "discontinued";
  unitPrice?: number;
  ticketsPerBook?: number;
  defaultRate?: number;
}

/** 遊戲(租戶頂層建、共用給全部分店)。 */
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
      launchedAt: null,
      discontinuedAt: null,
      claimDeadline: null,
      note: null,
      orgId: tenantId,
      tenantId,
      shareOrgs: [{ orgId: tenantId, includeDescendants: true }],
      moduleKey: "master-data",
      ...baseFields(now),
    });
  return insertedId;
}

let licenseSequence = 0;

/** 經銷商(租戶頂層建)。 */
export async function insertDealer(
  connection: Connection,
  tenantId: Types.ObjectId,
  dealer: {
    name: string;
    type?: "a" | "b";
    status?: "active" | "suspended" | "terminated";
    lastPurchaseBaseDate?: Date | null;
  },
): Promise<Types.ObjectId> {
  licenseSequence += 1;
  const now = new Date();
  const { insertedId } = await connection
    .collection("lottery_dealers")
    .insertOne({
      orgId: tenantId,
      tenantId,
      type: dealer.type ?? "a",
      licenseNo: String(12_345_000 + licenseSequence),
      name: dealer.name,
      status: dealer.status ?? "active",
      licenseApprovedAt: new Date("2024-01-01T00:00:00.000Z"),
      licenseExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
      lastPurchaseBaseDate: dealer.lastPurchaseBaseDate ?? null,
      lastSelfPurchaseBaseDate: null,
      lastPurchaseDate: dealer.lastPurchaseBaseDate ?? null,
      lastSelfPurchaseDate: null,
      nationalId: `A1${String(23_456_700 + licenseSequence)}`,
      residentialSameAsMailing: false,
      storeOrgId: null,
      shareOrgs: [],
      moduleKey: "dealers",
      ...baseFields(now),
    });
  return insertedId;
}

/** 關係人(受託人)+ 經銷商 → 關係人的受託人關聯。 */
export async function insertTrustee(
  connection: Connection,
  tenantId: Types.ObjectId,
  dealerId: Types.ObjectId | null,
  name: string,
  status: "active" | "disabled" = "active",
): Promise<Types.ObjectId> {
  licenseSequence += 1;
  const now = new Date();
  const { insertedId } = await connection
    .collection("lottery_dealer_contacts")
    .insertOne({
      orgId: tenantId,
      tenantId,
      name,
      roles: ["trustee"],
      nationalId: `B2${String(34_567_800 + licenseSequence)}`,
      status,
      residentialSameAsMailing: false,
      moduleKey: "dealers",
      ...baseFields(now),
    });
  if (dealerId !== null) {
    await connection.collection("lottery_relationships").insertOne({
      orgId: tenantId,
      tenantId,
      type: "lottery_dealer_lottery_dealer_contact",
      firstId: dealerId,
      secondId: insertedId,
      thirdId: null,
      meta: { role: "trustee" },
      moduleKey: "dealers",
      ...baseFields(now),
    });
  }
  return insertedId;
}

let accountSequence = 0;

/** 銀行帳戶:使用組織 = `usedBy`(含下層)。 */
export async function insertBankAccount(
  connection: Connection,
  tenantId: Types.ObjectId,
  usedBy: Types.ObjectId,
  status: "active" | "inactive" = "active",
): Promise<Types.ObjectId> {
  accountSequence += 1;
  const now = new Date();
  const accountNo = String(10_000_000_000 + accountSequence);
  const { insertedId } = await connection
    .collection("lottery_bank_accounts")
    .insertOne({
      orgId: tenantId,
      tenantId,
      bankCode: "004",
      branchName: "中山分行",
      accountNo,
      accountName: "好運彩券行",
      label: `好運彩券行 ${accountNo.slice(-5)}`,
      openingBalance: 0,
      openingDate: now,
      status,
      note: null,
      shareOrgs: [{ orgId: usedBy, includeDescendants: true }],
      moduleKey: "accounts",
      ...baseFields(now),
    });
  return insertedId;
}

/** 一張已完成、待購買的叫貨單(只寫叫貨明細副本)。 */
export async function insertRequisition(
  connection: Connection,
  tenantId: Types.ObjectId,
  orgId: Types.ObjectId,
  serialNo: string,
  lines: readonly { gameId: Types.ObjectId; books: number }[],
): Promise<Types.ObjectId> {
  const requisitionId = new Types.ObjectId();
  const now = new Date();
  await connection.collection("lottery_requisition_lines").insertMany(
    lines.map((line) => ({
      orgId,
      tenantId,
      requisitionId,
      serialNo,
      gameId: line.gameId,
      books: line.books,
      note: null,
      completedAt: now,
      voidedAt: null,
      referencedBy: null,
      moduleKey: "purchasing.requisition",
      ...baseFields(now),
    })),
  );
  return requisitionId;
}
