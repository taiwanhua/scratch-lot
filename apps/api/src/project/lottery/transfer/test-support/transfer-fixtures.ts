import type { Connection } from "mongoose";

import type { FormDefinition } from "@repo/domain/form";
import { TRANSFER_FIELD_KEYS } from "@repo/domain/project/lottery";

import {
  column,
  definitionOf,
  field,
} from "../../../../forms/test-support/form-fixtures";

/**
 * 調貨單測試的夾具。api 測試的資料庫只種底座,叫貨與進貨群組、調貨單模組與權限由這裡直接寫進
 * **隔離的測試資料庫**(形狀同 seed;先例 `purchase/test-support/purchase-fixtures.ts`)。
 */

export const TRANSFER_PERMISSION_KEYS = {
  view: "purchasing.transfer.view",
  create: "purchasing.transfer.create",
  edit: "purchasing.transfer.edit",
  delete: "purchasing.transfer.delete",
  partialTickets: "purchasing.transfer.partial-tickets",
  pay: "purchasing.transfer.pay",
  receive: "purchasing.transfer.receive",
} as const;

/** 受管表單的依欄位共用(`transfer.r3.seed.ts` 的 `sharedByFieldKeys`):出貨店、收貨店都看得到這張單。 */
export const TRANSFER_SHARED_BY_FIELD_KEYS = [
  TRANSFER_FIELD_KEYS.fromBranch,
  TRANSFER_FIELD_KEYS.toBranch,
];

export const TRANSFER_MODULE_KEYS = [
  "purchasing",
  "purchasing.transfer",
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

/** 叫貨與進貨群組、調貨單(表單模組)與它的權限。 */
export async function seedTransferAuthorization(
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
      key: "purchasing.transfer",
      name: "調貨單",
      parentId: groupId,
      ancestors: [groupId],
      route: "transfer",
      sidebarType: "link",
      order: 3,
      enabled: true,
      isSystem: false,
      icon: null,
      settings: {},
      engine: "form",
      ...baseFields(now),
    });
  await connection.collection("permissions").insertMany(
    Object.values(TRANSFER_PERMISSION_KEYS).map((key) => ({
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

/** 調貨單的定義(欄位 key 同受管表單 `seeds/project/revisions/transfer.r3.seed.ts`)。 */
export function transferDefinition(): FormDefinition {
  return definitionOf([
    field("note", "text"),
    field("from_branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("to_branch", "reference", {
      source: { provider: "org", labelField: "name" },
      rules: { required: true },
    }),
    field("requisition", "text"),
    field("lines", "array", {
      columns: [
        column("game", "reference", {
          source: { provider: "lottery_game", labelField: "name" },
        }),
        column("book", "reference", {
          source: {
            provider: "lottery_book",
            labelField: "bookKey",
            filter: { status: "normal" },
          },
          rules: { required: true },
        }),
        column("mode", "select", {
          options: {
            kind: "static",
            items: [
              { value: "whole", label: "整本", order: 1, enabled: true },
              { value: "partial", label: "選張", order: 2, enabled: true },
            ],
          },
          rules: { required: true },
        }),
        column("ticket_nos", "text"),
        column("tickets", "number", { rules: { required: true, min: 1 } }),
        column("amount", "number", { rules: { required: true, min: 0 } }),
        column("rate", "number", {
          rules: { required: true, min: 0, max: 100 },
        }),
        column("purchase_amount", "number", {
          valueSource: {
            kind: "computed",
            expr: {
              "/": [{ "*": [{ var: "row.amount" }, { var: "row.rate" }] }, 100],
            },
          },
        }),
      ],
      rules: { required: true },
    }),
    field("transfer_total", "number", {
      valueSource: {
        kind: "computed",
        expr: { sumOf: ["lines", "purchase_amount"] },
      },
    }),
  ]);
}
