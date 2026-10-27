/**
 * 張的狀態、位置、鎖定與張數事件(專案規格 7.1、7.2;正本 `docs/modules/project/inventory.md`「資料與帳本」)。
 * api 的 schema 與帳本服務、admin 的格子與文案都引用這裡,不另寫字面值。
 */

/** 張的狀態:未售 / 已售 / 跳號 / 報廢 / 待查 / 遺失。跳號 = 實體不存在,不算庫存、成本與損失。 */
export const TICKET_STATUSES = [
  "unsold",
  "sold",
  "skipped",
  "scrapped",
  "investigating",
  "lost",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS = {
  unsold: "unsold",
  sold: "sold",
  skipped: "skipped",
  scrapped: "scrapped",
  investigating: "investigating",
  lost: "lost",
} as const satisfies Record<string, TicketStatus>;

/** 張的位置:庫存 / 檯面(在某個收銀點)/ 在途(調貨中)。 */
export const TICKET_LOCATION_KINDS = [
  "stock",
  "counter",
  "in_transit",
] as const;
export type TicketLocationKind = (typeof TICKET_LOCATION_KINDS)[number];

export const TICKET_LOCATION_KIND = {
  stock: "stock",
  counter: "counter",
  inTransit: "in_transit",
} as const satisfies Record<string, TicketLocationKind>;

/** 鎖定來源:調貨單(= 「調貨中」)或撤銷售出申請。鎖定時不能賣。 */
export const TICKET_LOCK_REF_TYPES = ["transfer", "sale_reversal"] as const;
export type TicketLockRefType = (typeof TICKET_LOCK_REF_TYPES)[number];

/** 最近一次售出的來源:刷條碼 / 手動 / 盤點補登。 */
export const TICKET_SOLD_SOURCES = ["scan", "manual", "stocktake"] as const;
export type TicketSoldSource = (typeof TICKET_SOLD_SOURCES)[number];

/**
 * 張數事件類型(規格 7.2 的表;只新增,報表與盤點比對的唯一來源)。
 * 「拆本 / 收回 / 移櫃」「跳號 / 取消跳號」「調出 / 在途 / 調入」「待查 / 遺失 / 尋回」各是一種事件。
 */
export const TICKET_EVENT_TYPES = [
  "purchase",
  "purchase_void",
  "open",
  "recall",
  "move",
  "sale",
  "sale_stocktake",
  "sale_undo",
  "skip",
  "unskip",
  "scrap",
  "transfer_out",
  "in_transit",
  "transfer_in",
  "investigate",
  "lose",
  "recover",
  "cost_adjust",
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export const TICKET_EVENT_TYPE = {
  /** 進貨:店長點收一本(規格 8.3) */
  purchase: "purchase",
  /** 進貨作廢:進貨單作廢後 */
  purchaseVoid: "purchase_void",
  /** 拆本(店面管理) */
  open: "open",
  /** 收回:檯面 → 庫存 */
  recall: "recall",
  /** 移櫃:收銀點之間 */
  move: "move",
  /** 售出:刷條碼、手動、快速銷售 */
  sale: "sale",
  /** 售出(盤點補登):盤點差異核對 [補登售出] */
  saleStocktake: "sale_stocktake",
  /** 撤銷:當下撤銷;撤銷售出申請完成 */
  saleUndo: "sale_undo",
  /** 跳號:拆本時標註;本的詳情頁 [更正跳號] */
  skip: "skip",
  /** 取消跳號:本的詳情頁 [更正跳號] */
  unskip: "unskip",
  /** 報廢(`inventory.scrap`) */
  scrap: "scrap",
  /** 調出(調貨單) */
  transferOut: "transfer_out",
  /** 在途(調貨單) */
  inTransit: "in_transit",
  /** 調入(調貨單) */
  transferIn: "transfer_in",
  /** 待查(規格 7.4) */
  investigate: "investigate",
  /** 遺失(規格 7.4) */
  lose: "lose",
  /** 尋回(規格 7.4) */
  recover: "recover",
  /**
   * 成本調整:只改單張成本(狀態、位置、分店不變)。調貨單少張處理後,已點收張的單張成本改成縮小後那一列的
   * 批購金額 ÷ 張數(使用者 10/27 定案);事件的成本快照 = 調整前的成本,舊報表重跑不變
   */
  costAdjust: "cost_adjust",
} as const satisfies Record<string, TicketEventType>;

/** 事件對應有現金的影響:不影響 / 增加 / 減少(金額一律正數,方向看這裡)。 */
export const TICKET_CASH_EFFECTS = ["none", "increase", "decrease"] as const;
export type TicketCashEffect = (typeof TICKET_CASH_EFFECTS)[number];

/** 預計要給本數的「已給」只算這三種(累計,售出不扣;規格 7.6)。 */
export const ALLOCATION_IN_EVENT_TYPES: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.purchase,
  TICKET_EVENT_TYPE.transferIn,
];
export const ALLOCATION_OUT_EVENT_TYPES: readonly TicketEventType[] = [
  TICKET_EVENT_TYPE.transferOut,
];

function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (values as readonly string[]).includes(value)
  );
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return isOneOf(TICKET_STATUSES, value);
}

export function isTicketEventType(value: unknown): value is TicketEventType {
  return isOneOf(TICKET_EVENT_TYPES, value);
}

/** 事件 id = `<ticketId>:<版本>`(寫入後的版本);重送同一個 id 不重複寫入。 */
export function ticketEventIdOf(ticketId: string, version: number): string {
  return `${ticketId}:${String(version)}`;
}
