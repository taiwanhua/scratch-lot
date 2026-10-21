import { INVENTORY_KEY } from "@repo/domain/project/lottery";

/** 綁了庫存管理(遊戲詳情、乙類詳情的庫存分頁登記用;讀同一份資料、同一個守門)。 */
export const hasInventoryModule = (moduleKeys: ReadonlySet<string>): boolean =>
  moduleKeys.has(INVENTORY_KEY);
