import {
  type LocalDate,
  addLocalDays,
  addLocalMonths,
  clampedDateOfMonth,
  localDateDiff,
  localDateOf,
  startOfLocalDay,
} from "@repo/domain/form";

import type { RentCycle } from "../../database/lottery-dealers/lottery-dealer.schema";
import { LICENSE_EXPIRING_DAYS, PURCHASE_OVERDUE_DAYS } from "./dealer-keys";

/**
 * 經銷商管理的日期規則(純函式;時區一律是租戶時區)。
 * 正本:專案規格 5.2「牌租繳費日」「側欄計數」;模組文件 `docs/modules/project/dealers.md`「規則」。
 * 日曆運算一律用 `@repo/domain/form`(`addLocalDays`、`localDateDiff`、`clampedDateOfMonth`、`addLocalMonths`)。
 */

/** 某時點在租戶時區是哪一天。 */
export function localDayOf(instant: Date, timezone: string): LocalDate {
  return localDateOf(instant.getTime(), timezone);
}

/** 季別(1–4)。 */
export function quarterOf(date: LocalDate): number {
  return Math.floor((date.month - 1) / 3) + 1;
}

/** 牌租設定(乙類)。 */
export interface RentSetting {
  cycle: RentCycle;
  /** 起算月份(1–12);週期是月時不用 */
  startMonth: number | null;
  /** 繳費日(每期第一個月的第幾日,1–31) */
  dueDay: number;
}

/** 這個月是不是一期的第一個月(月:每個月;季:起算月份起每 3 個月;年:起算月份)。 */
export function isRentMonth(month: number, rent: RentSetting): boolean {
  if (rent.cycle === "month") {
    return true;
  }
  const start = rent.startMonth ?? 1;
  const offset = (((month - start) % 12) + 12) % 12;
  return rent.cycle === "quarter" ? offset % 3 === 0 : offset === 0;
}

/** 某年某月的繳費日(那個月沒有這一天用月底);不是繳費月 → null。 */
export function rentDueDateIn(
  year: number,
  month: number,
  rent: RentSetting,
): LocalDate | null {
  if (!isRentMonth(month, rent)) {
    return null;
  }
  return clampedDateOfMonth({ year, month }, rent.dueDay);
}

/** 這一天是不是繳費日。 */
export function isRentDueDate(date: LocalDate, rent: RentSetting): boolean {
  const due = rentDueDateIn(date.year, date.month, rent);
  return due !== null && due.day === date.day;
}

/** 從 `from`(含)起的下一個繳費日(最多看 12 個月)。 */
export function nextRentDueDate(
  from: LocalDate,
  rent: RentSetting,
): LocalDate | null {
  for (let offset = 0; offset <= 12; offset += 1) {
    const { year, month } = addLocalMonths(from, offset);
    const due = rentDueDateIn(year, month, rent);
    if (due !== null && localDateDiff(from, due) >= 0) {
      return due;
    }
  }
  return null;
}

/** 證照狀態:正常 / 30 天內到期(含今天)/ 已過期。 */
export type LicenseState = "ok" | "expiring" | "expired";

export function licenseStateOf(
  expiresAt: Date,
  today: LocalDate,
  timezone: string,
): LicenseState {
  const days = localDateDiff(today, localDayOf(expiresAt, timezone));
  if (days < 0) {
    return "expired";
  }
  return days <= LICENSE_EXPIRING_DAYS ? "expiring" : "ok";
}

/** 距某日幾天(今天 − 那天);沒有日期 → null(「無紀錄」)。 */
export function daysSince(
  date: Date | null,
  today: LocalDate,
  timezone: string,
): number | null {
  return date === null
    ? null
    : localDateDiff(localDayOf(date, timezone), today);
}

/**
 * 側欄計數與列表篩選共用的時點門檻(以「今天」算):
 * - `licenseBefore`:證照到期日早於它 = 30 天內到期或已過期(到期日 ≤ 今天 + 30)
 * - `purchaseBefore(n)`:批購日早於它 = 距今超過 n 天(批購日 ≤ 今天 − n − 1)
 */
export function thresholdsOf(today: LocalDate, timezone: string) {
  return {
    licenseBefore: new Date(
      startOfLocalDay(addLocalDays(today, LICENSE_EXPIRING_DAYS + 1), timezone),
    ),
    purchaseBefore: (overDays: number = PURCHASE_OVERDUE_DAYS): Date =>
      new Date(startOfLocalDay(addLocalDays(today, -overDays), timezone)),
  };
}
