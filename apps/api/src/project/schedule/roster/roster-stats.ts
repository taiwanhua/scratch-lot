import {
  type DayOffLike,
  consecutiveRuns,
  dayOffDates,
  fullDayOffDates,
} from "../day-offs/day-off-rules";

/** 統計用到的一筆排班。 */
export interface StatEntryLike {
  /** 租戶時區的日期鍵 `YYYY-MM-DD` */
  date: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  /** 這筆排班有任一筆填進的是負責人 */
  isLead: boolean;
}

/** 統計用到的時段不可排(畫休 `time-range`;`date` 是租戶時區的日期鍵,時段是時點)。 */
export interface StatSlotLike {
  date: string;
  startAt: Date;
  endAt: Date;
}

export interface RosterStats {
  shiftCount: number;
  leadShiftCount: number;
  workMinutes: number;
  dayOffDays: number;
  fullDayOffDays: number;
  /** 只有時段不可排的日子(日期鍵)與那天的時段(時點) */
  timeRangeDays: {
    date: string;
    slots: { startAt: Date; endAt: Date }[];
  }[];
  longestStreak: number;
}

const MS_PER_MINUTE = 60_000;

/** 一筆排班的上班分鐘數 = 下班 − 上班 − 休息(不小於 0)。 */
export function workMinutesOf(entry: {
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
}): number {
  const span = Math.round(
    (entry.endAt.getTime() - entry.startAt.getTime()) / MS_PER_MINUTE,
  );
  return Math.max(0, span - entry.breakMinutes);
}

/**
 * 班表檢視的統計欄(規格 14.5):
 *
 * - 班數 = 這家店這個月的排班筆數;負責班數以排班為單位(這筆排班任一任務是負責就算 1 班)
 * - 總工時 = 每筆(下班 − 上班 − 休息)加總,到分鐘
 * - 畫休天數 = 那天有任何畫休(整天或時段不可排)就算 1 天(同畫休規則 `dayOffDates`);
 *   hover 明細列整天畫休天數與只有時段不可排的日子(列出時段、不加總時數)
 * - 最長連續上班 = 有排班(任何分店)的日子最長連續幾天(`allWorkDates`)
 */
export function rosterStatsOf(input: {
  userId: string;
  entries: readonly StatEntryLike[];
  /** 這個人這個月有排班的日子(含其他分店) */
  allWorkDates: readonly string[];
  /** 這個人這個月的畫休(一段一筆) */
  dayOffs: readonly DayOffLike[];
  /** 這個人這個月的時段不可排(依開始時間) */
  slots: readonly StatSlotLike[];
}): RosterStats {
  const { userId, entries, dayOffs, slots } = input;
  const dates = dayOffDates(dayOffs, userId);
  const fullDays = new Set(fullDayOffDates(dayOffs, userId));
  const timeRangeDays = dates
    .filter((date) => !fullDays.has(date))
    .map((date) => ({
      date,
      slots: slots
        .filter((slot) => slot.date === date)
        .map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt })),
    }));
  const workDates = [...new Set(input.allWorkDates)].toSorted((left, right) =>
    left.localeCompare(right),
  );
  return {
    shiftCount: entries.length,
    leadShiftCount: entries.filter((entry) => entry.isLead).length,
    workMinutes: entries.reduce((sum, entry) => sum + workMinutesOf(entry), 0),
    dayOffDays: dates.length,
    fullDayOffDays: fullDays.size,
    timeRangeDays,
    longestStreak: Math.max(
      0,
      ...consecutiveRuns(workDates).map((run) => run.length),
    ),
  };
}
