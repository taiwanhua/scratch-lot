import { parseLocalDate } from "@repo/domain/form";

import {
  type DemandCounts,
  type RosterDemandLike,
  type RosterEntryLike,
  demandCountText,
  demandCountsOf,
  demandToneOf,
  minutesBetween,
  overlaps,
  shiftDay,
  weekdayOf,
} from "./schedule-roster";

/**
 * 排班表月 / 週 / 日檢視(規格 14.5「四種檢視」「人數寫法」「時間軸的人力需求容器」)的純函式:
 * 日期與週的換算、各位置的人數寫法、時間軸容器內的條(順序、缺額、×2、延伸)。
 * 畫面元件只把這裡的結果換成 `ScheduleTimeline` / `MonthCalendar` 的資料與文字。
 */

// ---- 日期 ----

/** `YYYY-MM-DD` 而且是真的日期(2/30 不算;`parseLocalDate`)。 */
export const isRosterDate = (value: string): boolean =>
  parseLocalDate(value) !== null;

/** 那一週的 7 天(一週從星期日開始,同底座 `MonthCalendar`)。 */
export const weekDatesOf = (date: string): string[] => {
  const start = shiftDay(date, -weekdayOf(date));
  return Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
};

/**
 * 週 / 日檢視顯示的那一天:網址的 `?date=` 落在目前的月份才用;否則這個月是今天所在的月份就用今天,
 * 不是就用這個月 1 日。
 */
export const rosterDateOf = (
  param: string,
  month: string,
  today: string,
): string => {
  if (isRosterDate(param) && param.startsWith(`${month}-`)) {
    return param;
  }
  return today.startsWith(`${month}-`) ? today : `${month}-01`;
};

/**
 * 週檢視跨月時多讀的範圍(`scheduleRoster` 的 `from` / `to`):那一週不全在這個月才給,否則 `null`。
 */
export const weekReadRangeOf = (
  date: string,
  month: string,
): { from: string; to: string } | null => {
  const dates = weekDatesOf(date);
  const from = dates[0] ?? date;
  const to = dates[6] ?? date;
  return from.startsWith(`${month}-`) && to.startsWith(`${month}-`)
    ? null
    : { from, to };
};

// ---- 人數寫法 ----

export interface CountLabels {
  /** 「負」「協」 */
  short: { leader: string; helper: string };
  /** 「負責」「協同」 */
  long: { leader: string; helper: string };
}

/** 已填 / 執行任務總筆數(不分職責)。 */
export const filledTotalOf = (
  counts: DemandCounts,
): { filled: number; total: number } => ({
  filled: counts.leaderFilled + counts.helperFilled,
  total: counts.leaderTotal + counts.helperTotal,
});

/** 「2/2」。 */
export const filledTotalText = (counts: DemandCounts): string => {
  const { filled, total } = filledTotalOf(counts);
  return `${String(filled)}/${String(total)}`;
};

/** 「負責 1/1 · 協同 0/1」(只寫有的職責;日檢視容器標題、手機卡片副標)。 */
export const longCountText = (
  counts: DemandCounts,
  labels: CountLabels["long"],
): string => {
  const parts: string[] = [];
  if (counts.leaderTotal > 0) {
    parts.push(
      `${labels.leader} ${String(counts.leaderFilled)}/${String(counts.leaderTotal)}`,
    );
  }
  if (counts.helperTotal > 0) {
    parts.push(
      `${labels.helper} ${String(counts.helperFilled)}/${String(counts.helperTotal)}`,
    );
  }
  return parts.join(" · ");
};

/** 一筆人力需求在各位置要寫的東西(簡稱、名稱、時間、崗位由畫面先算好)。 */
export interface DemandWording {
  /** 範本簡稱;未套用範本 = 「臨」 */
  shortName: string;
  /** 範本名稱;未套用範本 = 「臨」 */
  name: string;
  /** 「08:30–14:30」 */
  time: string;
  /** 崗位名稱(含收銀點註記) */
  position: string;
  counts: DemandCounts;
}

/**
 * 月檢視標籤(人數寫法表):
 * - 電腦:簡稱 + 時間,下一行「負x/y 協x/y」;只有協同時寫在同一行(只有負責仍是兩行)
 * - 平板:有負責人且已滿 → 只寫「簡稱 已填/總筆數」;其餘照電腦寫完整、一律兩行
 */
export const monthTagLines = (
  wording: DemandWording,
  device: "desktop" | "tablet",
  labels: CountLabels["short"],
): string[] => {
  const { counts } = wording;
  const head = `${wording.shortName} ${wording.time}`;
  const count = demandCountText(counts, labels);
  if (device === "tablet") {
    const { filled, total } = filledTotalOf(counts);
    if (counts.leaderTotal > 0 && filled === total) {
      return [`${wording.shortName} ${filledTotalText(counts)}`];
    }
    return [head, count];
  }
  // 只有協同(例:補貨)寫一行;有負責人的一律兩行(Figma SC-43:只有負責也是兩行)
  return counts.leaderTotal === 0 ? [`${head} ${count}`] : [head, count];
};

/** 「+N」長條清單浮層的一列(同月檢視電腦,寫成一行):「晚 14:30–22:00 負1/1 協0/1」。 */
export const moreListLine = (
  wording: DemandWording,
  labels: CountLabels["short"],
): string =>
  `${wording.shortName} ${wording.time} ${demandCountText(wording.counts, labels)}`;

/** 週檢視容器標題(直排簡寫):簡稱 + 已填 / 總筆數(不分職責)。 */
export const weekShortTitle = (
  wording: DemandWording,
): { shortName: string; count: string } => ({
  shortName: wording.shortName,
  count: filledTotalText(wording.counts),
});

/** 週檢視滑過容器標題的完整標題:「早班 · 櫃台 A 08:30–14:30 · 負1/1 協2/2」。 */
export const weekFullTitle = (
  wording: DemandWording,
  labels: CountLabels["short"],
): string =>
  `${wording.name} · ${wording.position} ${wording.time} · ${demandCountText(wording.counts, labels)}`;

/** 日檢視容器標題:「早班 · 店內櫃台 08:30–14:30 · 負責 1/1 · 協同 1/1」。 */
export const dayGroupTitle = (
  wording: DemandWording,
  labels: CountLabels["long"],
): string =>
  `${wording.name} · ${wording.position} ${wording.time} · ${longCountText(wording.counts, labels)}`;

/** 手機日檢視卡片:標題「班名 時間」、副標「崗位 · 負責 x/y · 協同 x/y」、右上「已填/總筆數」與缺幾人。 */
export const dayCardTexts = (
  wording: DemandWording,
  labels: CountLabels["long"],
): { title: string; subtitle: string; badge: string; missing: number } => {
  const { filled, total } = filledTotalOf(wording.counts);
  return {
    title: `${wording.name} ${wording.time}`,
    subtitle: `${wording.position} · ${longCountText(wording.counts, labels)}`,
    badge: filledTotalText(wording.counts),
    missing: total - filled,
  };
};

/** 手機週檢視(7 天清單)一天一列:「早 2/2 · 晚 1/2」。 */
export const weekListLine = (wordings: readonly DemandWording[]): string =>
  wordings
    .map((item) => `${item.shortName} ${filledTotalText(item.counts)}`)
    .join(" · ");

// ---- 手機卡片:上下班和人力需求不同時的加註 ----

/** 上下班時間和人力需求不同的分鐘數:正 = 比需求晚、負 = 比需求早;一樣 = 0。 */
export const entryOffsetsOf = (
  entry: { startAt: string; endAt: string },
  demand: { startAt: string; endAt: string },
): { start: number; end: number } => ({
  start: minutesBetween(demand.startAt, entry.startAt),
  end: minutesBetween(demand.endAt, entry.endAt),
});

// ---- 時間軸 ----

export interface TimelineTaskLike {
  taskId: string;
  role: string;
  entryId?: string | null;
  userId?: string | null;
}

export interface TimelineEntryLike extends RosterEntryLike {
  assignments: readonly {
    demandId: string;
    taskId: string;
    role: string;
    source: string;
  }[];
}

export interface TimelineDemandLike extends RosterDemandLike {
  createdAt: string;
  tasks: readonly TimelineTaskLike[];
}

/** 容器裡的一條:有人填的長條,或缺額虛線空位。 */
export type TimelineSlotPlan =
  | {
      kind: "bar";
      taskId: string;
      role: "leader" | "helper";
      entryId: string;
      userId: string;
      /** 排班的上下班時間(長條對齊實際時間,不對齊容器) */
      startAt: string;
      endAt: string;
      /** 超出容器時間的部分(由同一條長條延伸出去) */
      extendsBefore: boolean;
      extendsAfter: boolean;
      /** 同一筆排班同一段時間填進幾筆人力需求(含這筆);≥ 2 加「×N」徽章 */
      multiCount: number;
      isAuto: boolean;
    }
  | {
      kind: "vacancy";
      taskId: string;
      role: "leader" | "helper";
    };

export interface TimelineGroupPlan<Demand> {
  demand: Demand;
  /** 排序鍵:[崗位排序, 範本排序](未套用範本排最後) */
  sortKeys: [number, number];
  /** 建立時間(epoch 毫秒) */
  createdAt: number;
  /** 依職責、同職責先人後缺額:負責 → 缺負責 → 協同 → 缺協同 */
  slots: TimelineSlotPlan[];
  /** 容器框色:有缺負責紅、有缺協同橘、否則中性 */
  tone: GroupTone;
  counts: DemandCounts;
}

export interface TimelineOrders {
  /** 崗位在欄位管理的順序;找不到的排最後 */
  positionOrder: (positionKey: string) => number;
  /** 範本在範本清單的順序;未套用範本(或看不到)= null */
  templateOrder: (templateId: string | null | undefined) => number | null;
  /** 排班人員的順序(排班表人員列的順序) */
  personOrder: (userId: string) => number;
}

type GroupTone = "neutral" | "warning" | "error";
type BarPlan = Extract<TimelineSlotPlan, { kind: "bar" }>;
type Role = "leader" | "helper";

const toneOfCounts = (counts: DemandCounts): GroupTone => {
  const tone = demandToneOf(counts);
  if (tone === "grey") {
    return "neutral";
  }
  return tone === "error" ? "error" : "warning";
};

const hasEntryId = (
  task: TimelineTaskLike,
): task is TimelineTaskLike & { entryId: string } =>
  task.entryId !== null && task.entryId !== undefined;

/** 一筆有人填的執行任務 → 長條(對齊上下班時間;×N = 這筆排班和這筆人力需求同時段填進幾筆)。 */
const barPlanOf = (
  task: TimelineTaskLike,
  role: Role,
  entry: TimelineEntryLike,
  demand: RosterDemandLike,
  demandById: ReadonlyMap<string, RosterDemandLike>,
): BarPlan => {
  const concurrent = entry.assignments.filter((item) => {
    const other = demandById.get(item.demandId);
    return other !== undefined && overlaps(other, demand);
  }).length;
  return {
    kind: "bar",
    taskId: task.taskId,
    role,
    entryId: entry.id,
    userId: entry.userId,
    startAt: entry.startAt,
    endAt: entry.endAt,
    extendsBefore: Date.parse(entry.startAt) < Date.parse(demand.startAt),
    extendsAfter: Date.parse(entry.endAt) > Date.parse(demand.endAt),
    multiCount: Math.max(concurrent, 1),
    isAuto: entry.assignments.some(
      (item) =>
        item.demandId === demand.id &&
        item.taskId === task.taskId &&
        item.source === "auto",
    ),
  };
};

/** 同類長條:開始時間 → 排班人員排序 → id。 */
const compareBars =
  (orders: TimelineOrders) =>
  (left: BarPlan, right: BarPlan): number => {
    const byTime = Date.parse(left.startAt) - Date.parse(right.startAt);
    if (byTime !== 0) {
      return byTime;
    }
    const byPerson =
      orders.personOrder(left.userId) - orders.personOrder(right.userId);
    if (byPerson !== 0) {
      return byPerson;
    }
    return left.entryId < right.entryId ? -1 : 1;
  };

/** 一種職責的條:先有人填的長條、再缺額空位。 */
const roleSlotsOf = (
  demand: TimelineDemandLike,
  role: Role,
  entryById: ReadonlyMap<string, TimelineEntryLike>,
  demandById: ReadonlyMap<string, RosterDemandLike>,
  orders: TimelineOrders,
): TimelineSlotPlan[] => {
  const bars: BarPlan[] = [];
  const vacancies: TimelineSlotPlan[] = [];
  for (const task of demand.tasks) {
    if (task.role !== role) {
      continue;
    }
    const entry = hasEntryId(task) ? entryById.get(task.entryId) : undefined;
    if (entry === undefined) {
      vacancies.push({ kind: "vacancy", taskId: task.taskId, role });
    } else {
      bars.push(barPlanOf(task, role, entry, demand, demandById));
    }
  }
  return [...bars.toSorted(compareBars(orders)), ...vacancies];
};

/**
 * 時間軸的容器(週 / 日檢視):每筆人力需求一個容器,條數 = 執行任務筆數(一筆只填一人);
 * 條的順序依職責、同職責先人後缺額(負責 → 缺負責 → 協同 → 缺協同),同類依開始時間 → 排班人員排序 → id。
 * 排序鍵 = [崗位排序, 範本排序](開始時間與建立時間、id 由底座 `layoutTimeline` 接著比)。
 * 填的排班不在這份資料裡時當空的(缺額)。
 */
export const timelineGroupPlansOf = <Demand extends TimelineDemandLike>(
  demands: readonly Demand[],
  entries: readonly TimelineEntryLike[],
  orders: TimelineOrders,
): TimelineGroupPlan<Demand>[] => {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const demandById = new Map<string, RosterDemandLike>(
    demands.map((demand) => [demand.id, demand]),
  );
  return demands.map((demand) => {
    const slots = [
      ...roleSlotsOf(demand, "leader", entryById, demandById, orders),
      ...roleSlotsOf(demand, "helper", entryById, demandById, orders),
    ];
    const filled = new Set(
      slots.flatMap((slot) => (slot.kind === "bar" ? [slot.taskId] : [])),
    );
    const counts = demandCountsOf(
      demand.tasks.map((task) => ({
        ...task,
        entryId: filled.has(task.taskId) ? task.entryId : null,
      })),
    );
    return {
      demand,
      sortKeys: [
        orders.positionOrder(demand.positionKey),
        orders.templateOrder(demand.templateId) ?? Number.MAX_SAFE_INTEGER,
      ],
      createdAt: Date.parse(demand.createdAt),
      slots,
      tone: toneOfCounts(counts),
      counts,
    };
  });
};

/** 容器的完整排序(同底座 `layoutTimeline`):開始時間 → 崗位 → 範本 → 建立時間 → id(手機卡片清單用)。 */
export const compareGroupPlans = (
  left: TimelineGroupPlan<TimelineDemandLike>,
  right: TimelineGroupPlan<TimelineDemandLike>,
): number =>
  Date.parse(left.demand.startAt) - Date.parse(right.demand.startAt) ||
  left.sortKeys[0] - right.sortKeys[0] ||
  left.sortKeys[1] - right.sortKeys[1] ||
  left.createdAt - right.createdAt ||
  (left.demand.id < right.demand.id ? -1 : 1);

/** 「+N」長條的框色:收起的需求有缺負責紅、有缺協同橘、否則灰。 */
export const moreToneOf = (tones: readonly GroupTone[]): GroupTone => {
  if (tones.includes("error")) {
    return "error";
  }
  return tones.includes("warning") ? "warning" : "neutral";
};

/**
 * 每一天最嚴重的人力狀態(日檢視選日期月曆的點,和手機月檢視的點同一個意思):
 * 有缺負責 → `error`(紅)、只缺協同 → `warning`(橘);都排滿或沒有人力需求的日子不列(不畫點)。
 */
export const dayWorstTones = (
  demands: readonly RosterDemandLike[],
): Map<string, "error" | "warning"> => {
  const byDate = new Map<string, "error" | "warning">();
  for (const demand of demands) {
    const tone = demandToneOf(demandCountsOf(demand.tasks));
    if (tone === "error") {
      byDate.set(demand.date, "error");
    } else if (tone === "warning" && byDate.get(demand.date) !== "error") {
      byDate.set(demand.date, "warning");
    }
  }
  return byDate;
};
