/**
 * 給刮刮樂的排班查詢的比對規則(規格 14.9;純函式,`entry-lookup.ts` 呼叫)。
 */

export interface MatchableEntry {
  startAt: Date;
  endAt: Date;
}

/**
 * 「某人在某店某時間的排班」:時間落在 `[上班 − 容許, 下班 + 容許]` 的排班都算候選
 * (容許 = 規則 `entryMatchToleranceMinutes`,預設 60 分鐘;班中間開班也對得到),
 * 有多筆時取**上班時點離這個時間最近**的;同樣近取上班較早的。都不在容許範圍 → null。
 */
export function closestEntryAt<Entry extends MatchableEntry>(
  entries: readonly Entry[],
  at: Date,
  toleranceMinutes: number,
): Entry | null {
  const tolerance = toleranceMinutes * 60_000;
  const time = at.getTime();
  let best: Entry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const start = entry.startAt.getTime();
    if (time < start - tolerance || time > entry.endAt.getTime() + tolerance) {
      continue;
    }
    const distance = Math.abs(start - time);
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        best !== null &&
        start < best.startAt.getTime())
    ) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

/** 一筆排班填進的一筆執行任務,連同它所在的人力需求的崗位與上班時點。 */
export interface FilledTask {
  demandId: string;
  taskId: string;
  /** `leader` 負責人 / `helper` 協同 */
  role: string;
  taskKey: string;
  positionKey: string;
  demandStartAt: Date;
}

/**
 * 任務快照(規格 14.9「開班一定要選一筆排班」):在這筆排班填進的執行任務裡,找人力需求的崗位 = 收銀點崗位的那一筆;
 * 兩筆不同人力需求同崗位(又重疊)時,先選負責、再選人力需求開始較早的。對不到 → null。
 */
export function taskSnapshotOf(
  tasks: readonly FilledTask[],
  positionKey: string,
): FilledTask | null {
  const rank = (task: FilledTask) => (task.role === "leader" ? 0 : 1);
  const [best] = tasks
    .filter((task) => task.positionKey === positionKey)
    .toSorted(
      (left, right) =>
        rank(left) - rank(right) ||
        left.demandStartAt.getTime() - right.demandStartAt.getTime(),
    );
  return best ?? null;
}
