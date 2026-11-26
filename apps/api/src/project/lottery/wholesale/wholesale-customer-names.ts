import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import {
  WHOLESALE_FIELD_KEYS,
  wholesaleHeaderOf,
} from "@repo/domain/project/lottery";

import { OrgsRepository } from "../../../database/base/repositories";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { LotteryWholesaleCustomersRepository } from "../../database/lottery-dealers/lottery-dealers.repository";
import { objectIdsOf } from "./wholesale-books.service";

/** 引用欄存值的 `label`。 */
export function labelOf(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : "";
}

/**
 * 批售單上的批售客戶**店名**:單頭 `customer` 存的 label 是下拉文字「店名 · 電話」,列表、結算的對象、檢視頁只寫店名。
 * 看得到單據就看得到它的客戶店名(客戶不一定共用給讀者):以租戶邊界一次讀完;讀不到的退回存的 label。
 */
@Injectable()
export class WholesaleCustomerNames {
  constructor(
    private readonly customers: LotteryWholesaleCustomersRepository,
    private readonly orgs: OrgsRepository,
  ) {}

  /** 各單據的客戶店名(順序同 `values`;同一個租戶)。 */
  async storeNamesOf(
    tenantId: Types.ObjectId | null,
    values: readonly Record<string, unknown>[],
  ): Promise<string[]> {
    const ids = values.map((value) => wholesaleHeaderOf(value).customerId);
    const objectIds = objectIdsOf(ids);
    const found =
      objectIds.length === 0
        ? []
        : await this.customers.findMany(
            await tenantBoundaryContext(this.orgs, null, tenantId),
            { _id: { $in: objectIds } },
            { select: "storeName" },
          );
    const nameOf = new Map(
      found.map((customer) => [String(customer._id), customer.storeName]),
    );
    return values.map(
      (value, index) =>
        nameOf.get(ids[index] ?? "") ??
        labelOf(value[WHOLESALE_FIELD_KEYS.customer]),
    );
  }
}
