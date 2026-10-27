import { parseLocalDate, weekdayOfLocalDate } from "@repo/domain/form";

/**
 * 排班表的套用範本與自動排班(規格 14.4「套用範本」、14.5「自動排班」)的純函式:
 * 套用到的日子的快選([全選] [全不選] [平日] [週末])、範本與週範本的一行說明、條件的拖拉排序。
 * 套用的規則(相同時段略過、週範本只補空白日)在 api 算(預覽與套用同一個規劃),畫面不重算。
 */

/** 日期鍵的星期(0 = 星期日;`weekdayOfLocalDate`);不是日期鍵 → null(不算平日也不算週末)。 */
const weekdayOfDate = (date: string): number | null => {
  const day = parseLocalDate(date);
  return day === null ? null : weekdayOfLocalDate(day);
};

export type DatePreset = "all" | "none" | "weekdays" | "weekends";

/** 快選:從這個月可以選的日子(店休已排除)挑出全部 / 平日(一–五)/ 週末(六、日)/ 都不選。 */
export const datesOfPreset = (
  selectable: readonly string[],
  preset: DatePreset,
): string[] => {
  switch (preset) {
    case "all": {
      return [...selectable];
    }
    case "none": {
      return [];
    }
    case "weekdays": {
      return selectable.filter((date) => {
        const day = weekdayOfDate(date);
        return day !== null && day >= 1 && day <= 5;
      });
    }
    case "weekends": {
      return selectable.filter((date) => {
        const day = weekdayOfDate(date);
        return day === 0 || day === 6;
      });
    }
  }
};

/** 範本的人數「負責 + 協同」(例 `1+1`、`0+1`)。 */
export const templateHeadcountOf = (
  tasks: readonly { role: string }[],
): string => {
  const leaders = tasks.filter((task) => task.role === "leader").length;
  return `${String(leaders)}+${String(tasks.length - leaders)}`;
};

/** 星期一到星期日的順序(畫面上一週從一開始唸;0 = 星期日)。 */
const READING_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * 週範本的一行說明(例「一–五 早、晚;六、日 早」):星期一到星期日依序,範本相同的相鄰幾天併成一段
 * (連續 3 天以上寫「一–五」,否則「六、日」);沒有範本的日子不寫。
 */
export const weekTemplateSummary = (
  days: readonly (readonly string[])[],
  shortNameOf: (templateId: string) => string,
  weekdayLabels: readonly string[],
): string => {
  const groups: { days: number[]; text: string }[] = [];
  for (const day of READING_ORDER) {
    const ids = days[day] ?? [];
    if (ids.length === 0) {
      groups.push({ days: [], text: "" });
      continue;
    }
    const text = ids.map((id) => shortNameOf(id)).join("、");
    const last = groups.at(-1);
    if (last?.text === text && last.days.length > 0) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], text });
    }
  }
  return groups
    .filter((group) => group.days.length > 0)
    .map((group) => {
      const labels = group.days.map((day) => weekdayLabels[day] ?? "");
      const range =
        labels.length >= 3
          ? `${labels[0] ?? ""}–${labels.at(-1) ?? ""}`
          : labels.join("、");
      return `${range} ${group.text}`;
    })
    .join(";");
};

/** 把一項從 `from` 搬到 `to`(拖拉排序、鍵盤上下移)。 */
export const movedItem = <T>(
  list: readonly T[],
  from: number,
  to: number,
): T[] => {
  if (from === to || to < 0 || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) {
    next.splice(to, 0, item);
  }
  return next;
};
