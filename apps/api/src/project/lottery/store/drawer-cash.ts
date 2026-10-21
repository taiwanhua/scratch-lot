import type { Types } from "mongoose";

import type { OperatorContext } from "../../../database/operator-context";

/** 算抽屜應有時傳給來源的那一班。 */
export interface DrawerShift {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  orgId: Types.ObjectId;
  cashPointId: Types.ObjectId;
  openingFloat: number;
  /** 第一班開班時領零用金寫的出庫流水(期初已算進 `openingFloat`,現金流水來源要扣掉這一筆)。 */
  openingMovementId: Types.ObjectId | null;
}

/**
 * 抽屜應有的一個來源:這一班在這個來源的淨額(流入抽屜 +、流出 −)。`reader` 是呼叫端的讀取身分
 * (操作者,或租戶邊界的系統身分)。
 */
export type DrawerCashSource = (
  reader: OperatorContext,
  shift: DrawerShift,
) => Promise<number>;

const sources = new Map<string, DrawerCashSource>();

/**
 * **抽屜應有的來源登記**(規格 6.9 應有現金的各項;正本 `docs/modules/project/store.md`「抽屜應有」):
 * 店面本票登記「張數事件(售出 / 撤銷)」與「現金流水(投庫、出庫、調貨、退貨退款、現金更正)」兩個來源;
 * 兌獎等之後的功能在自己的 provider `onModuleInit` 登記自己的來源。`name` 全域唯一(重複 → 拋錯),
 * 回傳撤銷登記的函式。
 */
export function registerDrawerCashSource(
  name: string,
  source: DrawerCashSource,
): () => void {
  if (sources.has(name)) {
    throw new Error(`抽屜應有的來源 ${name} 已登記過`);
  }
  sources.set(name, source);
  return () => {
    sources.delete(name);
  };
}

/** 已登記的來源名稱(測試與文件核對用)。 */
export function drawerCashSourceNames(): string[] {
  return [...sources.keys()];
}

/**
 * **抽屜應有現金** `expectedDrawerCash(shift)` = 期初零用金 + 每個登記來源的淨額(應有只從紀錄加總,
 * 不存可被改寫的數字;第 17 章共通原則)。
 */
export async function expectedDrawerCash(
  reader: OperatorContext,
  shift: DrawerShift,
): Promise<number> {
  const amounts = await Promise.all(
    [...sources.values()].map((source) => source(reader, shift)),
  );
  return amounts.reduce((sum, amount) => sum + amount, shift.openingFloat);
}
