import type {
  BookCountKey,
  InventoryBookFilterState,
} from "@repo/domain/project/lottery";

/** 本上張數欄位的路徑。 */
const field = (key: BookCountKey): string => `ticketCounts.${key}`;

/** 這一格有張(> 0)。 */
const has = (key: BookCountKey): Record<string, unknown> => ({
  [field(key)]: { $gt: 0 },
});

/** 這一格沒有張(0;沒有這個欄位的舊資料也算 0)。 */
const none = (...keys: readonly BookCountKey[]): Record<string, unknown>[] =>
  keys.map((key) => ({ [field(key)]: { $not: { $gt: 0 } } }));

/** 沒有任何未售的張。 */
const NO_UNSOLD = none("stock", "counter", "inTransit");

/** 原封不動:從沒拆過、只有未售在庫存的張(`isBookSealed`)。 */
const SEALED: Record<string, unknown>[] = [
  { firstOpenedAt: null },
  has("stock"),
  ...none("counter", "inTransit", "sold", "scrapped", "investigating", "lost"),
];

/** 待標註張數 > 0:迄號 − 標準張數 − 已標跳號。 */
const PENDING_SKIP: Record<string, unknown> = {
  $expr: {
    $gt: [
      {
        $subtract: [
          { $toInt: "$lastTicketNo" },
          {
            $add: [
              "$standardTickets",
              { $size: { $ifNull: ["$skippedTicketNos", []] } },
            ],
          },
        ],
      },
      0,
    ],
  },
};

/**
 * 庫存分頁的狀態篩選 → 本的資料庫條件(以本上的張數欄位與第一次拆本時間篩,和 `bookDisplayStateOf` 的判斷
 * 順序一一對應;`inventory.test.ts` 以每種狀態的本核對兩邊一致)。回傳要 `$and` 的條件。
 */
export function bookStateConditionsOf(
  state: InventoryBookFilterState,
): Record<string, unknown>[] {
  switch (state) {
    case "unopened": {
      return SEALED;
    }
    case "on_counter": {
      return [has("counter")];
    }
    case "in_stock": {
      return [
        ...none("counter"),
        has("stock"),
        {
          $or: [
            { firstOpenedAt: { $ne: null } },
            has("inTransit"),
            has("sold"),
            has("scrapped"),
            has("investigating"),
            has("lost"),
          ],
        },
      ];
    }
    case "in_transit": {
      return [...none("counter", "stock"), has("inTransit")];
    }
    case "investigating": {
      return [...NO_UNSOLD, has("investigating")];
    }
    case "lost": {
      return [...NO_UNSOLD, ...none("investigating"), has("lost")];
    }
    case "scrapped": {
      return [
        ...NO_UNSOLD,
        ...none("investigating", "lost", "sold"),
        has("scrapped"),
      ];
    }
    case "sold_out": {
      return [
        ...NO_UNSOLD,
        ...none("investigating", "lost"),
        { $or: [has("sold"), ...none("scrapped")] },
      ];
    }
    case "pending_skip": {
      return [PENDING_SKIP];
    }
  }
}
