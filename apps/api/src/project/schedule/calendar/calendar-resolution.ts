/**
 * 行事曆的繼承(規格 14.1 `schedule_calendar_days`):某家店某天以**最接近的那一層**為準
 * (自己 → 上層 → … → 最上層組織)。上層設店休、本店自設特殊日 → 那天是本店的特殊日。
 */
export interface CalendarDayLike {
  orgId: { toString(): string };
  /** 租戶時區的日期鍵 `YYYY-MM-DD`(存值是那天 00:00 的時點,讀出來時換算) */
  localDate: string;
}

/** `chain[0]` = 自己;回每個日期生效的那一筆(依日期排序)。 */
export function pickEffectiveDays<T extends CalendarDayLike>(
  chain: readonly string[],
  records: readonly T[],
): T[] {
  const rank = new Map(chain.map((orgId, index) => [orgId, index]));
  const byDate = new Map<string, { record: T; rank: number }>();
  for (const record of records) {
    const recordRank = rank.get(record.orgId.toString());
    if (recordRank === undefined) {
      continue;
    }
    const current = byDate.get(record.localDate);
    if (current === undefined || recordRank < current.rank) {
      byDate.set(record.localDate, { record, rank: recordRank });
    }
  }
  return [...byDate.values()]
    .map((entry) => entry.record)
    .toSorted((left, right) => left.localDate.localeCompare(right.localDate));
}
