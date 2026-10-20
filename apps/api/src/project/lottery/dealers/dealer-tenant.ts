import type { TenantRef } from "../../../database/base.repository";
import type { LotteryDealerRef } from "./models/lottery-dealer.model";

/** 租戶內引用名稱出口回的一筆 → 經銷商的參照(欄位是 schema 的 `refFields`)。 */
export function dealerRefFrom(ref: TenantRef): LotteryDealerRef {
  return {
    id: String(ref._id),
    type: ref.type as LotteryDealerRef["type"],
    licenseNo: typeof ref.licenseNo === "string" ? ref.licenseNo : "",
    name: typeof ref.name === "string" ? ref.name : "",
    storeName: (ref.storeName as string | null | undefined) ?? null,
    status: ref.status as LotteryDealerRef["status"],
  };
}
