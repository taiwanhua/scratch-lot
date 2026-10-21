/**
 * 打卡的計算規則(規格 14.6 打卡、打卡不完整提醒;14.1 `schedule_attendance_punches`)。純函式,
 * 我的班表與出勤紀錄共用:
 *
 * - 同一班(同一筆排班)同類型多張:上班取最早、下班取最晚,其餘標「重複打卡」
 * - 缺卡**不存**,顯示時計算:只檢查**已結束**的班,上下班都檢查
 * - 打卡區只顯示今天的班 + 昨天未打下班卡的班
 */

export type PunchKind = "in" | "out";

export interface PunchLike {
  id: string;
  /** 對應排班;null = 未對應排班 */
  entryId: string | null;
  type: string;
  at: Date;
}

export interface EntryLike {
  id: string;
  /** `YYYY-MM-DD`(上班時點在租戶時區的那一天) */
  date: string;
  startAt: Date;
  endAt: Date;
}

/** 生效的那一張:上班取最早、下班取最晚(同時間取先寫入的,即陣列裡較前面的)。 */
function effectiveOf<Punch extends PunchLike>(
  punches: readonly Punch[],
  type: PunchKind,
): Punch | null {
  let best: Punch | null = null;
  for (const punch of punches) {
    if (punch.type !== type) {
      continue;
    }
    if (
      best === null ||
      (type === "in"
        ? punch.at.getTime() < best.at.getTime()
        : punch.at.getTime() > best.at.getTime())
    ) {
      best = punch;
    }
  }
  return best;
}

/**
 * 重複打卡的 id:每一班每種類型只有一張生效,其餘都是重複。
 * 未對應排班的卡(`entryId = null`)不算「同一班」,一律不標。
 */
export function duplicatePunchIdsOf(
  punches: readonly PunchLike[],
): Set<string> {
  const byEntry = new Map<string, PunchLike[]>();
  for (const punch of punches) {
    if (punch.entryId === null) {
      continue;
    }
    const list = byEntry.get(punch.entryId) ?? [];
    list.push(punch);
    byEntry.set(punch.entryId, list);
  }
  const duplicates = new Set<string>();
  for (const list of byEntry.values()) {
    for (const type of ["in", "out"] as const) {
      const kept = effectiveOf(list, type);
      for (const punch of list) {
        if (punch.type === type && punch !== kept) {
          duplicates.add(punch.id);
        }
      }
    }
  }
  return duplicates;
}

/** 某一班生效的上班卡與下班卡時點(沒打 = null)。 */
export function effectivePunchesOf(
  entryId: string,
  punches: readonly PunchLike[],
): { clockIn: Date | null; clockOut: Date | null } {
  const mine = punches.filter((punch) => punch.entryId === entryId);
  return {
    clockIn: effectiveOf(mine, "in")?.at ?? null,
    clockOut: effectiveOf(mine, "out")?.at ?? null,
  };
}

/** 這一班缺的卡:還沒結束(下班時點晚於現在)= 不檢查,回空陣列。 */
export function missingPunchesOf(
  entry: EntryLike,
  punches: readonly PunchLike[],
  now: Date,
): PunchKind[] {
  if (entry.endAt.getTime() > now.getTime()) {
    return [];
  }
  const { clockIn, clockOut } = effectivePunchesOf(entry.id, punches);
  return [
    ...(clockIn === null ? (["in"] as const) : []),
    ...(clockOut === null ? (["out"] as const) : []),
  ];
}

/** 打卡不完整的班(日期在 `from`–`to` 內、已結束、缺上班或下班卡),依上班時點排序。 */
export function incompleteEntriesOf<Entry extends EntryLike>(
  entries: readonly Entry[],
  punches: readonly PunchLike[],
  now: Date,
  range: { from: string; to: string },
): { entry: Entry; missing: PunchKind[] }[] {
  return entries
    .filter((entry) => entry.date >= range.from && entry.date <= range.to)
    .map((entry) => ({ entry, missing: missingPunchesOf(entry, punches, now) }))
    .filter((item) => item.missing.length > 0)
    .toSorted(
      (left, right) =>
        left.entry.startAt.getTime() - right.entry.startAt.getTime(),
    );
}

export interface PunchableEntry<Entry extends EntryLike> {
  entry: Entry;
  day: "today" | "yesterday";
}

/**
 * 打卡區的班:今天的班(上下班都能打)+ 昨天還沒打下班卡的班(只能打下班卡)。
 * `today` / `yesterday` 是租戶時區的 `YYYY-MM-DD`。
 */
export function punchableEntriesOf<Entry extends EntryLike>(
  entries: readonly Entry[],
  punches: readonly PunchLike[],
  days: { today: string; yesterday: string },
): PunchableEntry<Entry>[] {
  return entries
    .flatMap((entry): PunchableEntry<Entry>[] => {
      if (entry.date === days.today) {
        return [{ entry, day: "today" }];
      }
      if (
        entry.date === days.yesterday &&
        effectivePunchesOf(entry.id, punches).clockOut === null
      ) {
        return [{ entry, day: "yesterday" }];
      }
      return [];
    })
    .toSorted((left, right) => {
      // 今天的班在前(打卡區最上方是今天),同一天依上班時點
      if (left.day !== right.day) {
        return left.day === "today" ? -1 : 1;
      }
      return left.entry.startAt.getTime() - right.entry.startAt.getTime();
    });
}

/** 這張卡打不打得進這一班:今天的班兩種都可以,昨天未打下班卡的班只能打下班卡。 */
export function canPunchEntry(
  entry: EntryLike,
  type: PunchKind,
  punches: readonly PunchLike[],
  days: { today: string; yesterday: string },
): boolean {
  return punchableEntriesOf([entry], punches, days).some(
    (item) => item.day === "today" || type === "out",
  );
}

/**
 * 今天未對應排班、還沒打下班卡的那張上班卡(「沒有排班」區塊展開並醒目顯示 [打下班卡]):
 * 最後一張未對應排班的卡是上班卡才算。
 */
export function openUnmatchedClockInOf<Punch extends PunchLike>(
  todayPunches: readonly Punch[],
): Punch | null {
  const unmatched = todayPunches
    .filter((punch) => punch.entryId === null)
    .toSorted((left, right) => left.at.getTime() - right.at.getTime());
  const last = unmatched.at(-1);
  return last?.type === "in" ? last : null;
}
