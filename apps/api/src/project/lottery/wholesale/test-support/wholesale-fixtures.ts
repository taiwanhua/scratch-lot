import type { Connection, Types } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import {
  WHOLESALE_FIELD_KEYS,
  wholesaleCustomerLabel,
} from "@repo/domain/project/lottery";

import {
  column,
  definitionOf,
  field,
} from "../../../../forms/test-support/form-fixtures";
import { LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION } from "../../../database/lottery-dealers/lottery-wholesale-customer.schema";

/**
 * 批售單測試的夾具。api 測試的資料庫只種底座,叫貨與進貨群組、批售單模組與權限由這裡直接寫進
 * **隔離的測試資料庫**(形狀同 seed;先例 `transfer/test-support/transfer-fixtures.ts`)。
 */

export const WHOLESALE_PERMISSION_KEYS = {
  view: "purchasing.wholesale.view",
  create: "purchasing.wholesale.create",
  edit: "purchasing.wholesale.edit",
  delete: "purchasing.wholesale.delete",
  receive: "purchasing.wholesale.receive",
} as const;

export const WHOLESALE_MODULE_KEYS = [
  "purchasing",
  "purchasing.wholesale",
] as const;

/** 受管表單的依欄位共用(`wholesale.r1.seed.ts`):出貨分店看得到總部替它開的單。 */
export const WHOLESALE_SHARED_BY_FIELD_KEYS = [WHOLESALE_FIELD_KEYS.fromBranch];

function baseFields(now: Date): Record<string, unknown> {
  return {
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
}

async function insertModule(
  connection: Connection,
  module: {
    key: string;
    name: string;
    route: string;
    sidebarType: string;
    engine: string;
  },
  parentId: Types.ObjectId | null,
  permissionKeys: readonly string[],
): Promise<Types.ObjectId> {
  const now = new Date();
  const { insertedId } = await connection.collection("modules").insertOne({
    ...module,
    parentId,
    ancestors: parentId === null ? [] : [parentId],
    order: 940,
    enabled: true,
    isSystem: false,
    icon: null,
    settings: {},
    ...baseFields(now),
  });
  if (permissionKeys.length > 0) {
    await connection.collection("permissions").insertMany(
      permissionKeys.map((key) => ({
        key,
        moduleId: insertedId,
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
  return insertedId;
}

/** 叫貨與進貨群組、批售單(表單模組)與它的權限;店面(刷條碼、盤點)、庫存(成本)的模組與權限。 */
export async function seedWholesaleAuthorization(
  connection: Connection,
): Promise<void> {
  const groupId = await insertModule(
    connection,
    {
      key: "purchasing",
      name: "叫貨與進貨",
      route: "purchasing",
      sidebarType: "group",
      engine: "fixed",
    },
    null,
    [],
  );
  await insertModule(
    connection,
    {
      key: "purchasing.wholesale",
      name: "批售單",
      route: "wholesale",
      sidebarType: "link",
      engine: "form",
    },
    groupId,
    Object.values(WHOLESALE_PERMISSION_KEYS),
  );
  await insertModule(
    connection,
    {
      key: "inventory",
      name: "庫存管理",
      route: "inventory",
      sidebarType: "link",
      engine: "fixed",
    },
    null,
    ["inventory.show-cost"],
  );
  await insertModule(
    connection,
    {
      key: "store",
      name: "店面管理",
      route: "store",
      sidebarType: "link",
      engine: "form",
    },
    null,
    ["store.view", "store.sell", "store.stocktake"],
  );
  await insertModule(
    connection,
    {
      key: "accounts",
      name: "帳戶管理",
      route: "accounts",
      sidebarType: "link",
      engine: "fixed",
    },
    null,
    ["accounts.view-outstanding"],
  );
}

/** 一位批售客戶(預設往來中、共用給整個租戶)。 */
export async function insertWholesaleCustomer(
  connection: Connection,
  tenantId: Types.ObjectId,
  customer: { storeName: string; phone?: string | null; status?: string },
): Promise<Types.ObjectId> {
  const now = new Date();
  const phone = customer.phone ?? null;
  const { insertedId } = await connection
    .collection(LOTTERY_WHOLESALE_CUSTOMERS_COLLECTION)
    .insertOne({
      storeName: customer.storeName,
      phone,
      label: wholesaleCustomerLabel({ storeName: customer.storeName, phone }),
      licenseNo: null,
      contactName: null,
      status: customer.status ?? "active",
      address: null,
      note: null,
      orgId: tenantId,
      tenantId,
      shareOrgs: [{ orgId: tenantId, includeDescendants: true }],
      moduleKey: "dealers",
      ...baseFields(now),
    });
  return insertedId;
}

/** 批售單的定義(欄位 key 同受管表單 `seeds/project/revisions/wholesale.r1.seed.ts`)。 */
export function wholesaleDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text"),
    field("from_branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("customer", "reference", {
      source: {
        provider: "lottery_wholesale_customer",
        labelField: "label",
        filter: { status: "active" },
      },
      rules: { required: true },
    }),
    field("payment_mode", "select", {
      options: {
        kind: "static",
        items: [
          {
            value: "auto_bank",
            label: "從帳戶入帳",
            order: 1,
            enabled: true,
          },
          {
            value: "collect_first",
            label: "收到錢再核准",
            order: 2,
            enabled: true,
          },
        ],
      },
      default: { kind: "constant", value: "collect_first" },
      rules: { required: true },
    }),
    field("account", "reference", {
      source: {
        provider: "lottery_bank_account",
        labelField: "label",
        filter: { status: "active" },
      },
      visibleWhen: { "==": [{ var: "payment_mode" }, "auto_bank"] },
      rules: { required: true },
    }),
    field("lines", "array", {
      columns: [
        column("game", "reference", {
          source: { provider: "lottery_game", labelField: "name" },
          rules: { required: true },
        }),
        column("book", "reference", {
          source: {
            provider: "lottery_book",
            labelField: "bookKey",
            filter: { status: "normal" },
          },
          rules: { required: true },
        }),
        column("tickets", "number", { rules: { required: true, min: 1 } }),
        column("book_price", "number", { rules: { required: true, min: 0 } }),
        column("rate", "number", {
          rules: { required: true, min: 0, max: 100 },
        }),
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
      rules: { required: true, maxRows: 200 },
    }),
    field("wholesale_total", "number", {
      valueSource: { kind: "computed", expr: { sumOf: ["lines", "amount"] } },
    }),
  ]);
}
