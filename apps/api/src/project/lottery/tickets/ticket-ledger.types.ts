import type { Types } from "mongoose";

import type {
  TicketCashEffect,
  TicketEventType,
  TicketLockRefType,
  TicketSoldSource,
  TicketStatus,
} from "@repo/domain/project/lottery";

import type { OperatorContext } from "../../../database/operator-context";
import type { TicketLocation } from "../../database/lottery-inventory/lottery-ticket.schema";

/**
 * 帳本用哪個範圍讀寫:
 *
 * - 預設 = **操作者自己的範圍**(張要在他的可見範圍內,寫入不放大)
 * - `crossStoreTenantId` = 這個租戶的**租戶邊界上下文**(例外寫入:調入、尋回到刷到的那家店這類
 *   「張還在別的分店、由收貨 / 刷到的這家店的人寫」);仍記得是哪位操作者(基礎欄位與搬家稽核)。
 *   **只能把張移進操作者看得到的店**:每一筆都要帶 `patch.orgId`、目標在他的可見範圍內,否則 `FORBIDDEN`;
 *   鎖定 / 解除不接受跨店
 * - `operator: null` = 沒有操作者的系統寫入,一定要給 `crossStoreTenantId`,而且不能換店(搬家要寫稽核);
 *   給了 `systemActorId`(觸發這次系統寫入的人,例:作廢調貨單的人)才能換店,目標可以是租戶內任何一家店,
 *   搬家稽核與事件的「誰」記這個人(事後動作的系統身分沒有操作者)
 */
export interface LedgerContext {
  operator: OperatorContext | null;
  crossStoreTenantId?: Types.ObjectId;
  /** 只配 `operator: null`:系統寫入代表誰(換店的稽核記他)。 */
  systemActorId?: Types.ObjectId | null;
}

/** 這次事件要把張改成什麼(沒給的欄位不變)。 */
export interface TicketStatePatch {
  status?: TicketStatus;
  location?: TicketLocation;
  /** 換到哪家分店(調入、尋回到刷到的那家店);以搬家入口 `reassignOrg` 寫。 */
  orgId?: Types.ObjectId;
  /** 責任分店(待查或遺失時填;尋回時清成 null)。 */
  responsibleOrgId?: Types.ObjectId | null;
  /** 單張成本(調入時改成調貨單那一列的批購金額 ÷ 張數)。 */
  unitCost?: number;
  /** 最近一次售出;null = 清掉(撤銷)。售出的「誰」一律是帳本的操作者。 */
  sold?: {
    at: Date;
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
 * - 「誰」= 帳本的操作者(沒有操作者 = null);金額一律正數,方向看 `cashEffect`
 */
export interface TicketEventInput {
  ticketId: Types.ObjectId;
  expectedVersion: number;
  expectedStatuses?: readonly TicketStatus[];
  allowLockedBy?: TicketLockRef;
  type: TicketEventType;
  /** 發生時間;不給 = 現在。 */
  at?: Date;
  patch: TicketStatePatch;
  amount?: number;
  /** 當下的成本快照(報廢:這張的單張成本);不給 = null。 */
  cost?: number | null;
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

/** 鎖定 / 解除後每張的版本(鎖定與解除會用掉一個版本,不寫事件)。 */
export interface TicketVersion {
  ticketId: string;
  version: number;
  /** false = 已是要的狀態(重送),版本沒變。 */
  changed: boolean;
}
