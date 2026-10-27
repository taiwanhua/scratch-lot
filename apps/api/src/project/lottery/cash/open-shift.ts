import type { Types } from "mongoose";

import type { OperatorContext } from "../../../database/operator-context";

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

/** 一家分店一個開著的抽屜(收銀點的班)。 */
export interface OpenDrawer {
  cashPointId: Types.ObjectId;
  cashPointName: string;
  shiftId: Types.ObjectId;
  openedBy: Types.ObjectId;
  openedAt: Date;
  /** 抽屜目前的應有現金。 */
  expected: number;
}

/**
 * 「這家分店現在有哪些開著的抽屜」的登記(即時現金帳列出各收銀點抽屜應有、收付的現金來源列出抽屜;
 * 規格 9、10.2)。由店面(P21 收銀班次)在 `onModuleInit` 登記;登記之前一律回空清單。
 * `reader` 是呼叫端的讀取身分;依收銀點排序回傳。
 */
export type OpenDrawersLister = (
  reader: OperatorContext,
  orgId: Types.ObjectId,
) => Promise<OpenDrawer[]>;

let drawersLister: OpenDrawersLister | null = null;

/** 登記(一個;重複 → 拋錯)。回傳撤銷登記的函式。 */
export function registerOpenDrawersLister(next: OpenDrawersLister): () => void {
  if (drawersLister !== null) {
    throw new Error("開著的抽屜清單已登記過");
  }
  drawersLister = next;
  return () => {
    drawersLister = null;
  };
}

/** 分店開著的抽屜;沒有登記 → 空清單。 */
export async function openDrawersOf(
  reader: OperatorContext,
  orgId: Types.ObjectId,
): Promise<OpenDrawer[]> {
  return (await drawersLister?.(reader, orgId)) ?? [];
}
