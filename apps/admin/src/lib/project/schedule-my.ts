import { localPartsOf } from "./schedule-roster";

/**
 * 我的班表 → 班表分頁(規格 14.6)的純函式:時間文字、缺卡寫法、「新」的異動、條列的日子。
 * 缺卡、打卡區、打卡不完整都由 api 算好;這裡只組畫面要的值。
 */

/** 班的時間「08:30–14:30」(租戶時區)。 */
export const timeRangeOf = (
  entry: { startAt: string; endAt: string },
  timezone: string,
): string =>
  `${localPartsOf(entry.startAt, timezone).time}–${localPartsOf(entry.endAt, timezone).time}`;

/** 打卡時間「08:24」;沒打 = null。 */
export const punchTimeOf = (
  value: string | null | undefined,
  timezone: string,
): string | null =>
  value === null || value === undefined
    ? null
    : localPartsOf(value, timezone).time;

export type MissingKey = "missingIn" | "missingOut" | "missingBoth";

/** 缺卡的寫法:缺上班卡 / 缺下班卡 / 缺上下班卡;沒缺 = null。 */
export const missingKeyOf = (missing: readonly string[]): MissingKey | null => {
  const hasIn = missing.includes("in");
  const hasOut = missing.includes("out");
  if (hasIn && hasOut) {
    return "missingBoth";
  }
  if (hasIn) {
    return "missingIn";
  }
  return hasOut ? "missingOut" : null;
};

/**
 * 「新」的異動:異動時間晚於上次打開這一頁的時間(存在瀏覽器)。第一次打開(沒有紀錄)= 全部都是新的。
 */
export const newChangeIdsOf = (
  changes: readonly { id: string; createdAt: string }[],
  lastVisit: string | null,
): Set<string> =>
  new Set(
    changes
      .filter(
        (change) =>
          lastVisit === null ||
          new Date(change.createdAt).getTime() > new Date(lastVisit).getTime(),
      )
      .map((change) => change.id),
  );

/** 依日期分組(保持原本順序)。 */
export const groupByDate = <Item extends { date: string }>(
  items: readonly Item[],
): Map<string, Item[]> => {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const list = groups.get(item.date) ?? [];
    list.push(item);
    groups.set(item.date, list);
  }
  return groups;
};

/**
 * 條列檢視列出的日子(依日期):有班、畫休、店休的日子,加上今天(在這個月時)。
 */
export const listDatesOf = (input: {
  month: string;
  today: string;
  entryDates: readonly string[];
  dayOffDates: readonly string[];
  closedDates: readonly string[];
}): string[] => {
  const dates = new Set([
    ...input.entryDates,
    ...input.dayOffDates,
    ...input.closedDates,
    ...(input.today.startsWith(`${input.month}-`) ? [input.today] : []),
  ]);
  return [...dates]
    .filter((date) => date.startsWith(`${input.month}-`))
    .toSorted((left, right) => left.localeCompare(right));
};

/** 「上次打開這一頁」存在瀏覽器的 key(以使用者區分;同一台電腦換人登入不互相影響)。 */
export const lastVisitKeyOf = (userId: string): string =>
  `schedule.my.lastVisit:${userId}`;

/** 讀上次打開的時間;沒有或瀏覽器不給存 → null。 */
export const readLastVisit = (userId: string): string | null => {
  try {
    return globalThis.localStorage.getItem(lastVisitKeyOf(userId));
  } catch {
    return null;
  }
};

/** 記下這次打開的時間;瀏覽器不給存就略過(只是「新」標記不準)。 */
export const writeLastVisit = (userId: string, now: string): void => {
  try {
    globalThis.localStorage.setItem(lastVisitKeyOf(userId), now);
  } catch {
    // 私密瀏覽等情況存不了:不影響其他功能
  }
};
