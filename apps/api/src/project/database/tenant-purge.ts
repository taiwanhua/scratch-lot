import type { TenantPurgeRegistration } from "../../database/tenant-purge";
import { FIELD_OPTION_COLORS_COLLECTION } from "./field-option-colors/field-option-color.schema";
import { LOTTERY_BANK_ACCOUNTS_COLLECTION } from "./lottery-accounts/lottery-bank-account.schema";
import { LOTTERY_BANK_TRANSACTIONS_COLLECTION } from "./lottery-accounts/lottery-bank-transaction.schema";
import { LOTTERY_CASH_MOVEMENTS_COLLECTION } from "./lottery-accounts/lottery-cash-movement.schema";
import { LOTTERY_CASH_POINTS_COLLECTION } from "./lottery-cash-points/lottery-cash-point.schema";
import { LOTTERY_DEALER_CONTACTS_COLLECTION } from "./lottery-dealers/lottery-dealer-contact.schema";
import { LOTTERY_DEALER_SIGNINS_COLLECTION } from "./lottery-dealers/lottery-dealer-signin.schema";
import { LOTTERY_DEALERS_COLLECTION } from "./lottery-dealers/lottery-dealer.schema";
import { LOTTERY_RELATIONSHIPS_COLLECTION } from "./lottery-dealers/lottery-relationship.schema";
import { LOTTERY_GAMES_COLLECTION } from "./lottery-games/lottery-game.schema";
import { LOTTERY_ALLOCATIONS_COLLECTION } from "./lottery-inventory/lottery-allocation.schema";
import { LOTTERY_BOOKS_COLLECTION } from "./lottery-inventory/lottery-book.schema";
import { LOTTERY_TICKET_EVENTS_COLLECTION } from "./lottery-inventory/lottery-ticket-event.schema";
import { LOTTERY_TICKETS_COLLECTION } from "./lottery-inventory/lottery-ticket.schema";
import { LOTTERY_PURCHASE_RECEIPTS_COLLECTION } from "./lottery-purchases/lottery-purchase-receipt.schema";
import { LOTTERY_REQUISITION_LINES_COLLECTION } from "./lottery-requisitions/lottery-requisition-line.schema";
import { LOTTERY_SHIFTS_COLLECTION } from "./lottery-store/lottery-shift.schema";
import { LOTTERY_TRANSFER_RECEIPTS_COLLECTION } from "./lottery-transfers/lottery-transfer-receipt.schema";
import { SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION } from "./schedule/schedule-attendance-punch.schema";
import { SCHEDULE_AUTO_RUNS_COLLECTION } from "./schedule/schedule-auto-run.schema";
import { SCHEDULE_CALENDAR_DAYS_COLLECTION } from "./schedule/schedule-calendar-day.schema";
import { SCHEDULE_CHANGES_COLLECTION } from "./schedule/schedule-change.schema";
import { SCHEDULE_DAY_OFF_LOCKS_COLLECTION } from "./schedule/schedule-day-off-lock.schema";
import { SCHEDULE_DAY_OFFS_COLLECTION } from "./schedule/schedule-day-off.schema";
import { SCHEDULE_DEMAND_TEMPLATES_COLLECTION } from "./schedule/schedule-demand-template.schema";
import { SCHEDULE_DEMAND_WEEK_TEMPLATES_COLLECTION } from "./schedule/schedule-demand-week-template.schema";
import { SCHEDULE_DEMANDS_COLLECTION } from "./schedule/schedule-demand.schema";
import { SCHEDULE_ENTRY_LOCKS_COLLECTION } from "./schedule/schedule-entry-lock.schema";
import { SCHEDULE_ENTRIES_COLLECTION } from "./schedule/schedule-entry.schema";
import { SCHEDULE_PERIODS_COLLECTION } from "./schedule/schedule-period.schema";
import { SCHEDULE_RELATIONSHIPS_COLLECTION } from "./schedule/schedule-relationship.schema";
import { SCHEDULE_SETTINGS_COLLECTION } from "./schedule/schedule-setting.schema";
import { SCHEDULE_STAFF_COLLECTION } from "./schedule/schedule-staff.schema";
import { SCHEDULE_TASK_ASSIGNMENTS_COLLECTION } from "./schedule/schedule-task-assignment.schema";

/** 專案的表都帶 `tenantId`(模組資料表),一律依 `tenantId` 刪。 */
const byTenantId = (collection: string): TenantPurgeRegistration => ({
  collection,
  rule: { by: "tenantId" },
});

/**
 * 專案 collection 的「清空示範機構時怎麼刪」(`database/tenant-purge.ts`;由 `database.module.ts` 組裝)。
 *
 * 新增專案資料表(`project/database/registrations.ts` 加 model)時在這裡同 PR 加一筆;
 * 沒登記 → `database/tenant-purge.test.ts` 的完整性測試失敗。只能新增的帳本(流水、事件)也照樣刪。
 */
export const PROJECT_TENANT_PURGE_REGISTRATIONS: readonly TenantPurgeRegistration[] =
  [
    FIELD_OPTION_COLORS_COLLECTION,
    LOTTERY_GAMES_COLLECTION,
    LOTTERY_CASH_POINTS_COLLECTION,
    LOTTERY_DEALERS_COLLECTION,
    LOTTERY_DEALER_CONTACTS_COLLECTION,
    LOTTERY_DEALER_SIGNINS_COLLECTION,
    LOTTERY_RELATIONSHIPS_COLLECTION,
    LOTTERY_BOOKS_COLLECTION,
    LOTTERY_TICKETS_COLLECTION,
    LOTTERY_TICKET_EVENTS_COLLECTION,
    LOTTERY_ALLOCATIONS_COLLECTION,
    LOTTERY_BANK_ACCOUNTS_COLLECTION,
    LOTTERY_BANK_TRANSACTIONS_COLLECTION,
    LOTTERY_CASH_MOVEMENTS_COLLECTION,
    LOTTERY_REQUISITION_LINES_COLLECTION,
    LOTTERY_PURCHASE_RECEIPTS_COLLECTION,
    LOTTERY_TRANSFER_RECEIPTS_COLLECTION,
    LOTTERY_SHIFTS_COLLECTION,
    SCHEDULE_SETTINGS_COLLECTION,
    SCHEDULE_CALENDAR_DAYS_COLLECTION,
    SCHEDULE_DAY_OFFS_COLLECTION,
    SCHEDULE_DAY_OFF_LOCKS_COLLECTION,
    SCHEDULE_DEMANDS_COLLECTION,
    SCHEDULE_DEMAND_TEMPLATES_COLLECTION,
    SCHEDULE_DEMAND_WEEK_TEMPLATES_COLLECTION,
    SCHEDULE_PERIODS_COLLECTION,
    SCHEDULE_STAFF_COLLECTION,
    SCHEDULE_ENTRIES_COLLECTION,
    SCHEDULE_ENTRY_LOCKS_COLLECTION,
    SCHEDULE_RELATIONSHIPS_COLLECTION,
    SCHEDULE_TASK_ASSIGNMENTS_COLLECTION,
    SCHEDULE_CHANGES_COLLECTION,
    SCHEDULE_AUTO_RUNS_COLLECTION,
    SCHEDULE_ATTENDANCE_PUNCHES_COLLECTION,
  ].map((collection) => byTenantId(collection));
