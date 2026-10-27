import type { ScheduleTimeRange } from "./roster";

/**
 * 時段不可排的幾段(半開區間 `[startAt, endAt)`)合起來有沒有蓋滿那一天 `day`(租戶時區那天 00:00 到隔天
 * 00:00;夏令時間切換日是 23 / 25 小時,一樣用時點比)。重疊或頭尾相接的段落視為連在一起;
 * 開始不早於結束的段落不算。蓋滿了就是整天,要登記整天畫休(admin 停用儲存、api 回
 * `VALIDATION_FAILED` `slots`,兩邊共用本函式)。
 */
export function dayOffSlotsCoverDay(
  slots: readonly ScheduleTimeRange[],
  day: ScheduleTimeRange,
): boolean {
  let covered = day.startAt;
  for (const slot of slots
    .filter((item) => item.startAt < item.endAt)
    .toSorted((left, right) => left.startAt - right.startAt)) {
    if (slot.startAt > covered) {
      break;
    }
    covered = Math.max(covered, slot.endAt);
  }
  return day.startAt < day.endAt && covered >= day.endAt;
}
