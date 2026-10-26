import type { LotteryInventoryPlaceFieldsFragment } from "@repo/graphql";

/**
 * 庫存管理(`inventory`)前端的常數(權限表正本 `docs/modules/project/inventory.md`)。
 * 模組 key、權限 key、分頁值與 api / seed 同一份(`@repo/domain/project/lottery`)。
 */
export {
  INVENTORY_LOOKUP_SCAN_PURPOSE,
  INVENTORY_MODULE_KEYS,
  INVENTORY_PERMISSIONS,
  INVENTORY_TABS,
} from "@repo/domain/project/lottery";

/** 庫存列表的最小寬度(STYLE-11:八欄不折行)。 */
export const BOOKS_TABLE_MIN_WIDTH = 960;

/** 待查·遺失列表的最小寬度(STYLE-11:十欄不折行)。 */
export const INVESTIGATIONS_TABLE_MIN_WIDTH = 1120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 登記到現在過了幾天(待查·遺失的「天數」;不滿一天算 0)。 */
export const daysSince = (at: string, now: number = Date.now()): number =>
  Math.max(0, Math.floor((now - new Date(at).getTime()) / DAY_MS));

/** 事件時間軸的最小寬度。 */
export const TIMELINE_TABLE_MIN_WIDTH = 720;

/** 金額顯示(千分位)。 */
export const moneyText = (value: number): string =>
  value.toLocaleString("en-US");

/** 各分店持有張數:只有一家顯示店名;拆開的本顯示「台北 70 / 新竹 30」。 */
export const holdingsText = (
  holdings: readonly { org: { name: string }; count: number }[],
): string =>
  holdings.length <= 1
    ? (holdings[0]?.org.name ?? "")
    : holdings
        .map((item) => `${item.org.name} ${String(item.count)}`)
        .join(" / ");

/** 地方:「中山店 · 店內櫃台」;沒有收銀點時用位置名稱(庫存 / 在途)。 */
export const placeText = (
  place: LotteryInventoryPlaceFieldsFragment,
  kindLabel: (kind: string) => string,
): string =>
  `${place.org.name} · ${place.cashPoint?.name ?? kindLabel(place.locationKind)}`;
