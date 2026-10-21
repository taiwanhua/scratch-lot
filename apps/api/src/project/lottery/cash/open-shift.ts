import type { Types } from "mongoose";

/**
 * 「這個收銀點現在有沒有開著的班」的登記(收付用現金、來源選抽屜時要找發生班次;規格 9)。
 * 由店面(P21 收銀班次)在 `onModuleInit` 登記;登記之前一律回 null(只能從小金庫付)。
 */
export type OpenShiftResolver = (
  tenantId: Types.ObjectId | null,
  cashPointId: Types.ObjectId,
) => Promise<{ shiftId: Types.ObjectId; orgId: Types.ObjectId } | null>;

let resolver: OpenShiftResolver | null = null;

/** 登記(一個;重複 → 拋錯)。回傳撤銷登記的函式。 */
export function registerOpenShiftResolver(next: OpenShiftResolver): () => void {
  if (resolver !== null) {
    throw new Error("開著的班的查詢已登記過");
  }
  resolver = next;
  return () => {
    resolver = null;
  };
}

/** 收銀點開著的班;沒有登記或沒開班 → null。 */
export async function openShiftOf(
  tenantId: Types.ObjectId | null,
  cashPointId: Types.ObjectId,
): Promise<{ shiftId: Types.ObjectId; orgId: Types.ObjectId } | null> {
  return (await resolver?.(tenantId, cashPointId)) ?? null;
}
