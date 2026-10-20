import type { Types } from "mongoose";

import type { TenantRef } from "../../../database/base.repository";
import type { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { systemTenantReader } from "../../../database/system-tenant-reader";
import type { LotteryDealerRef } from "./models/lottery-dealer.model";

/**
 * 經銷商管理以**租戶**為邊界的讀(ADR-0005 的 `systemTenantReader`):可見範圍 = 該租戶整棵組織樹。
 * 只給這幾種用途,條件一律再釘 `tenantId`:
 * - 關聯反查(乙類的共同銷售人、已被對應的分店、關係人掛在哪些經銷商)—— 問的是整個租戶
 * - 看得到經銷商就讀得到它的關聯列(關聯的 `orgId` 屬經銷商,共用進來的經銷商關聯不在讀者的可見範圍)
 * - 關係人取消身分時一併解除別人經銷商上的關聯(例外寫入,`dealer-links.service.ts` 的 `releaseContactRoles`)
 *
 * 根組織的資料沒有租戶(`tenantId = null`):根組織成員的可見範圍本來就是全部,直接用操作者自己的上下文。
 */
export async function dealerTenantReader(
  orgs: OrgsRepository,
  operator: OperatorContext,
  tenantId: Types.ObjectId | null,
): Promise<OperatorContext> {
  return tenantId === null ? operator : systemTenantReader(orgs, tenantId);
}

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
