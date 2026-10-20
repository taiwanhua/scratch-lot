import type { Types } from "mongoose";

import type {
  TicketCashEffect,
  TicketEventType,
  TicketLockRefType,
  TicketSoldSource,
  TicketStatus,
} from "@repo/domain/project/lottery";

import type { TicketLocation } from "../../database/lottery-inventory/lottery-ticket.schema";

/** 這次事件要把張改成什麼(沒給的欄位不變)。 */
export interface TicketStatePatch {
  status?: TicketStatus;
  location?: TicketLocation;
  /** 目前所在分店(調入、尋回到刷到的那家店)。 */
  storeOrgId?: Types.ObjectId;
  /** 責任分店(待查或遺失時填;尋回時清成 null)。 */
  responsibleOrgId?: Types.ObjectId | null;
  /** 單張成本(調入時改成調貨單那一列的批購金額 ÷ 張數)。 */
  unitCost?: number;
  /** 最近一次售出;null = 清掉(撤銷)。 */
  sold?: {
    at: Date;
    by: Types.ObjectId | null;
    source: TicketSoldSource;
  } | null;
}

/** 鎖定的來源(調貨單 / 撤銷售出申請)。 */
export interface TicketLockRef {
  refType: TicketLockRefType;
  refId: Types.ObjectId;
}

/**
 * 一筆張數事件(`TicketLedgerService.applyTicketEvents` 的輸入)。
 *
 * - **條件**:張的 `version` 要等於 `expectedVersion`(呼叫端讀到的),給了 `expectedStatuses` 時狀態也要在其中;
 *   被鎖定的張只有 `allowLockedBy` 是同一個鎖時才能動(例:調貨單自己鎖住的張寫調出 / 調入)
 * - **事件 id** = `<ticketId>:<expectedVersion + 1>`:同一個 id 已寫過且內容相同 → 重送,不重複寫入
 * - 金額一律正數,方向看 `cashEffect`
 */
export interface TicketEventInput {
  /** 這張所在的租戶(租戶頂層 id;同一批事件必須同一個租戶)。 */
  tenantId: Types.ObjectId;
  ticketId: Types.ObjectId;
  expectedVersion: number;
  expectedStatuses?: readonly TicketStatus[];
  allowLockedBy?: TicketLockRef;
  type: TicketEventType;
  /** 誰(使用者 id;系統動作為 null)。 */
  by: Types.ObjectId | null;
  /** 發生時間;不給 = 現在。 */
  at?: Date;
  patch: TicketStatePatch;
  amount?: number;
  cashEffect?: TicketCashEffect;
  cashPointId?: Types.ObjectId | null;
  shiftId?: Types.ObjectId | null;
  refType?: string | null;
  refId?: Types.ObjectId | null;
  reasonKey?: string | null;
  reasonNote?: string | null;
}

/** 一筆事件的結果:`applied: false` = 重送(同一個事件 id 已寫過),沒有再寫。 */
export interface TicketEventResult {
  ticketId: string;
  eventId: string;
  version: number;
  applied: boolean;
}

/** `lockTickets` / `unlockTickets` 的鎖。 */
export interface TicketLockInput extends TicketLockRef {
  /** 這些張所在的租戶(租戶頂層 id)。 */
  tenantId: Types.ObjectId;
}
