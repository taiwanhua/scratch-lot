/**
 * 行事曆的繼承(規格 14.1 `schedule_calendar_days`):某家店某天以**最接近的那一層**為準
 * (自己 → 上層 → … → 最上層組織)。上層設店休、本店自設特殊日 → 那天是本店的特殊日。
 */
export interface CalendarDayLike {
  orgId: { toString(): string };
  /** 那天(租戶時區 00:00 的時點;同一個租戶的各層同一天是同一個時點) */
  date: Date;
}

/** `chain[0]` = 自己;回每個日期生效的那一筆(依日期排序)。 */
export function pickEffectiveDays<T extends CalendarDayLike>(
  chain: readonly string[],
  records: readonly T[],
): T[] {
  const rank = new Map(chain.map((orgId, index) => [orgId, index]));
  const byDate = new Map<number, { record: T; rank: number }>();
  for (const record of records) {
    const recordRank = rank.get(record.orgId.toString());
    if (recordRank === undefined) {
      continue;
    }
    const current = byDate.get(record.date.getTime());
    if (current === undefined || recordRank < current.rank) {
      byDate.set(record.date.getTime(), { record, rank: recordRank });
    }
  }
  return [...byDate.values()]
    .map((entry) => entry.record)
    .toSorted((left, right) => left.date.getTime() - right.date.getTime());
}
