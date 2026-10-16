/**
 * `ScheduleTimeline` 週模式的排版(規格 10.11「週模式排版」):決定一天欄內每個容器的左邊位置,
 * 或整個收起(收進當天欄最右邊的「+N」長條)。純函式,不含 React,元件與測試共用同一份。
 *
 * - 容器寬 = 20(直排標題)+ 28 × 條數。
 * - 依完整排序逐一放:開始時間 → 模組提供的排序鍵 → 建立時間 → id;從最左邊找第一個「在這個容器
 *   整段時間內都空得下它的寬度」的位置,找不到就整個收起;已放好的不移動;時間不重疊的容器可共用位置。
 * - 只要有容器被收起,先保留最右邊 24px 給「+N」長條,再從頭重排一次。
 * - 決定性:不讀時鐘、不用亂數、不依賴輸入陣列順序;欄寬先取整數 px(容器寬都是整數,
 *   排法只在欄寬跨過整數時才可能改變)。
 */

/** 容器左側直排標題的寬(px)。 */
export const TIMELINE_GROUP_TITLE_WIDTH = 20;
/** 容器內一條長條佔的寬(px)。 */
export const TIMELINE_SLOT_WIDTH = 28;
/** 有收起時,當天欄最右邊保留給「+N」長條的寬(px)。 */
export const TIMELINE_MORE_WIDTH = 24;

/** 排版需要的容器資料(模組的「群組」,例:一筆人力需求)。 */
export interface TimelineLayoutGroup {
  /** 唯一識別;排序的最後一關,保證不平手。 */
  id: string;
  /** 開始時間;與 `end`、`createdAt` 用同一種數值單位即可(例:epoch 毫秒)。 */
  start: number;
  /** 結束時間(不含):前一個在 14:30 結束、下一個在 14:30 開始不算重疊。 */
  end: number;
  /** 佔的條數(非負整數,由模組提供;例:班表 = 執行任務筆數,空的佔虛線空位)。 */
  slots: number;
  /** 模組提供的排序鍵,逐項升冪比較(例:[崗位排序, 範本排序]);較短的視為較前。 */
  sortKeys?: readonly number[];
  /** 建立時間(排序鍵之後的平手規則)。 */
  createdAt: number;
}

export interface TimelinePlacement<G extends TimelineLayoutGroup> {
  group: G;
  /** 容器在當天欄內的左邊位置(px,0 起)。 */
  x: number;
  /** 容器寬(px)= 20 + 28 × 條數。 */
  width: number;
}

export interface TimelineLayout<G extends TimelineLayoutGroup> {
  /** 放得下的容器,依完整排序。 */
  placed: TimelinePlacement<G>[];
  /** 收起的容器,依完整排序;長度就是「+N」的 N,空陣列時不畫「+N」長條。 */
  collapsed: G[];
}

/** 容器寬(px)。 */
export const timelineGroupWidth = (slots: number): number =>
  TIMELINE_GROUP_TITLE_WIDTH + TIMELINE_SLOT_WIDTH * slots;

const compareSortKeys = (
  a: readonly number[] = [],
  b: readonly number[] = [],
): number => {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return a.length - b.length;
};

/** id 以 code unit 比較,不受執行環境的語系影響。 */
const compareIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/** 完整排序:開始時間 → 排序鍵 → 建立時間 → id。 */
const compareGroups = (a: TimelineLayoutGroup, b: TimelineLayoutGroup) =>
  a.start - b.start ||
  compareSortKeys(a.sortKeys, b.sortKeys) ||
  a.createdAt - b.createdAt ||
  compareIds(a.id, b.id);

const overlapsInTime = (a: TimelineLayoutGroup, b: TimelineLayoutGroup) =>
  a.start < b.end && b.start < a.end;

const placeAll = <G extends TimelineLayoutGroup>(
  sorted: readonly G[],
  available: number,
): TimelineLayout<G> => {
  const placed: TimelinePlacement<G>[] = [];
  const collapsed: G[] = [];
  for (const group of sorted) {
    const width = timelineGroupWidth(group.slots);
    const neighbours = placed.filter((p) => overlapsInTime(p.group, group));
    const candidates = [0, ...neighbours.map((p) => p.x + p.width)].toSorted(
      (m, n) => m - n,
    );
    const x = candidates.find(
      (left) =>
        left + width <= available &&
        neighbours.every((p) => left + width <= p.x || left >= p.x + p.width),
    );
    if (x === undefined) {
      collapsed.push(group);
    } else {
      placed.push({ group, x, width });
    }
  }
  return { placed, collapsed };
};

/**
 * 週模式一天欄的排版。`dayWidth` 是當天欄寬(px,設計稿:電腦 157、平板 125);
 * 店休等不排容器的日子由呼叫端傳空陣列。
 */
export const layoutTimeline = <G extends TimelineLayoutGroup>(
  groups: readonly G[],
  dayWidth: number,
): TimelineLayout<G> => {
  const sorted = groups.toSorted(compareGroups);
  const available = Math.floor(dayWidth);
  const firstPass = placeAll(sorted, available);
  return firstPass.collapsed.length === 0
    ? firstPass
    : placeAll(sorted, available - TIMELINE_MORE_WIDTH);
};
