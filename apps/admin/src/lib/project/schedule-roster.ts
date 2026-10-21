import {
  formatTemporal,
  instantOfLocalTime,
  parseLocalDate,
  toIso,
} from "@repo/domain/form";
import { minutesOfHhMm } from "@repo/domain/project/schedule-settings";
import type { TagTone } from "@repo/ui/tag";

/**
 * 排班表(規格 14.5「排班表」)的純函式:時點與當地日期 / 時間的換算、人數寫法、三態顏色、
 * 人力需求區的列、收合時的每日彙總、人員格子的內容。畫面元件只組字串與排版。
 */

// ---- 時間 ----

/** 時點 → 租戶時區的 `{ date: YYYY-MM-DD, time: HH:mm }`。 */
export const localPartsOf = (
  value: string,
  timezone: string,
): { date: string; time: string } => {
  const text = formatTemporal(value, { type: "datetime", timezone });
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
};

/** 某天的 `HH:mm`(租戶時區)→ ISO 時點;日期或時間不合法 → null。 */
export const instantOfDayTime = (
  date: string,
  time: string,
  timezone: string,
): string | null => {
  const day = parseLocalDate(date);
  const minutes = minutesOfHhMm(time);
  if (day === null || minutes === null) {
    return null;
  }
  return toIso(
    instantOfLocalTime(day, Math.floor(minutes / 60), minutes % 60, timezone),
  );
};

/** `YYYY-MM-DD` 加減天數。 */
export const shiftDay = (date: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

/**
 * 開始 / 結束(同一天的 `HH:mm`)→ 兩個時點;結束不晚於開始 = 跨午夜(結束算隔天)。
 * 任一不合法 → null。
 */
export const spanOf = (
  date: string,
  startTime: string,
  endTime: string,
  timezone: string,
): { startAt: string; endAt: string } | null => {
  const start = minutesOfHhMm(startTime);
  const end = minutesOfHhMm(endTime);
  if (start === null || end === null) {
    return null;
  }
  const startAt = instantOfDayTime(date, startTime, timezone);
  const endAt = instantOfDayTime(
    end <= start ? shiftDay(date, 1) : date,
    endTime,
    timezone,
  );
  return startAt === null || endAt === null ? null : { startAt, endAt };
};

/** 兩個時點相差幾分鐘。 */
export const minutesBetween = (startAt: string, endAt: string): number =>
  Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000);

/** 某月(`YYYY-MM`)的每一天(`YYYY-MM-DD`)。 */
export const datesOfMonth = (month: string): string[] => {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from(
    { length: last },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
};

/** `YYYY-MM` 加減月份。 */
export const shiftMonthOf = (month: string, delta: number): string => {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
};

/** 星期幾(0 = 星期日)。 */
export const weekdayOf = (date: string): number => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/** `M/D`。 */
export const monthDayOf = (date: string): string =>
  `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`;

// ---- 人數寫法與三態 ----

export interface RosterTaskLike {
  taskId: string;
  role: string;
  entryId?: string | null;
}

export interface DemandCounts {
  leaderFilled: number;
  leaderTotal: number;
  helperFilled: number;
  helperTotal: number;
}

/** 一筆人力需求的已填 / 執行任務筆數(依職責)。 */
export const demandCountsOf = (
  tasks: readonly RosterTaskLike[],
): DemandCounts => {
  const leaders = tasks.filter((task) => task.role === "leader");
  const helpers = tasks.filter((task) => task.role === "helper");
  const filled = (items: readonly RosterTaskLike[]) =>
    items.filter((task) => task.entryId !== null && task.entryId !== undefined)
      .length;
  return {
    leaderFilled: filled(leaders),
    leaderTotal: leaders.length,
    helperFilled: filled(helpers),
    helperTotal: helpers.length,
  };
};

/**
 * 實心三態(規格 14.5「人數檢查」):缺負責 → error(紅)、缺協同 → warning(橘)、已滿 → grey
 * (綠色只代表負責人,不用來表示已滿)。
 */
export const demandToneOf = (counts: DemandCounts): TagTone => {
  if (counts.leaderFilled < counts.leaderTotal) {
    return "error";
  }
  if (counts.helperFilled < counts.helperTotal) {
    return "warning";
  }
  return "grey";
};

/** 三態取最嚴重的(彙總列的顏色:取當天最嚴重的狀態)。 */
export const worstTone = (tones: readonly TagTone[]): TagTone => {
  if (tones.includes("error")) {
    return "error";
  }
  return tones.includes("warning") ? "warning" : "grey";
};

/**
 * 人數寫法(規格 14.5「人數寫法」班表人力需求區):「負x/y 協x/y」;只有協同時「協x/y」、只有負責時「負x/y」。
 * `leader` / `helper` 是「負」「協」的文字(i18n)。
 */
export const demandCountText = (
  counts: DemandCounts,
  labels: { leader: string; helper: string },
): string => {
  const parts: string[] = [];
  if (counts.leaderTotal > 0) {
    parts.push(
      `${labels.leader}${String(counts.leaderFilled)}/${String(counts.leaderTotal)}`,
    );
  }
  if (counts.helperTotal > 0) {
    parts.push(
      `${labels.helper}${String(counts.helperFilled)}/${String(counts.helperTotal)}`,
    );
  }
  return parts.join(" ");
};

// ---- 人力需求區 ----

export interface RosterDemandLike extends RosterRangeLike {
  id: string;
  date: string;
  templateId?: string | null;
  positionKey: string;
  tasks: readonly RosterTaskLike[];
}

export interface RosterRangeLike {
  startAt: string;
  endAt: string;
}

/** 人力需求區一列:一種人力需求範本;未套用範本的歸「臨」列(`templateId` = null)。 */
export interface DemandAreaRow<Demand> {
  templateId: string | null;
  /** 每天的人力需求(依開始時間) */
  byDate: ReadonlyMap<string, Demand[]>;
}

/**
 * 人力需求區的列:看得到的每一種範本一列(依範本順序;沒有人力需求的範本也列出,點空白格可以帶入那一列的範本),
 * 最後一列「臨」(未套用範本、或範本已看不到的人力需求)。
 */
export const demandAreaRows = <Demand extends RosterDemandLike>(
  templateIds: readonly string[],
  demands: readonly Demand[],
): DemandAreaRow<Demand>[] => {
  const known = new Set(templateIds);
  const group = (rowId: string | null) => {
    const byDate = new Map<string, Demand[]>();
    for (const demand of demands) {
      const id =
        demand.templateId !== null &&
        demand.templateId !== undefined &&
        known.has(demand.templateId)
          ? demand.templateId
          : null;
      if (id === rowId) {
        byDate.set(demand.date, [...(byDate.get(demand.date) ?? []), demand]);
      }
    }
    return byDate;
  };
  return [
    ...templateIds.map((id) => ({ templateId: id, byDate: group(id) })),
    { templateId: null, byDate: group(null) },
  ];
};

/** 收合時每天一格的彙總:需 N · 已排 N / 缺 N · 可排 N(顏色取當天最嚴重的狀態)。 */
export interface DaySummary {
  need: number;
  filled: number;
  missing: number;
  available: number;
  tone: TagTone;
}

export const daySummaryOf = (
  demands: readonly RosterDemandLike[],
  availableCount: number,
): DaySummary | null => {
  if (demands.length === 0) {
    return null;
  }
  const counts = demands.map((demand) => demandCountsOf(demand.tasks));
  const need = counts.reduce(
    (sum, item) => sum + item.leaderTotal + item.helperTotal,
    0,
  );
  const filled = counts.reduce(
    (sum, item) => sum + item.leaderFilled + item.helperFilled,
    0,
  );
  return {
    need,
    filled,
    missing: need - filled,
    available: availableCount,
    tone: worstTone(counts.map((item) => demandToneOf(item))),
  };
};

// ---- 人員格子 ----

export interface RosterEntryLike extends RosterRangeLike {
  id: string;
  userId: string;
  date: string;
  breakMinutes: number;
  assignments: readonly { demandId: string; role: string; source: string }[];
}

/** 兩段時間重疊(相接不算)。 */
export const overlaps = (left: RosterRangeLike, right: RosterRangeLike) =>
  Date.parse(left.startAt) < Date.parse(right.endAt) &&
  Date.parse(right.startAt) < Date.parse(left.endAt);

/** 一筆排班在格子上的樣子。 */
export interface EntryChip {
  /** 範本簡稱(臨 = null,由畫面寫「臨」);同一段時間填進兩筆以上 → 只寫第一筆的簡稱 */
  shortNames: (string | null)[];
  /** 同一段時間填進兩筆以上人力需求(「晚 ×2」) */
  multiCount: number;
  /** 任一筆是負責 → 負責人底色 */
  isLead: boolean;
  /** 自動排入(任一筆來源是自動) */
  isAuto: boolean;
}

/**
 * 班表格子上的一筆排班:寫範本簡稱(負責人套負責人底色、未套用範本寫「臨」)、休息「☕ 30」;
 * 同一筆排班同一段時間填進兩筆以上人力需求寫「晚 ×2」;不重疊的多筆(跨好幾段)寫「早 + 晚」。
 */
export const entryChipOf = (
  entry: RosterEntryLike,
  demands: ReadonlyMap<string, RosterDemandLike>,
  shortNameOf: (templateId: string | null | undefined) => string | null,
): EntryChip => {
  const assigned = entry.assignments
    .map((item) => demands.get(item.demandId))
    .filter((demand): demand is RosterDemandLike => demand !== undefined)
    .toSorted(
      (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt),
    );
  let multiCount = 1;
  for (const demand of assigned) {
    const concurrent = assigned.filter((other) =>
      overlaps(demand, other),
    ).length;
    multiCount = Math.max(multiCount, concurrent);
  }
  const names = assigned.map((demand) => shortNameOf(demand.templateId));
  return {
    shortNames: multiCount > 1 ? names.slice(0, 1) : [...new Set(names)],
    multiCount,
    isLead: entry.assignments.some((item) => item.role === "leader"),
    isAuto: entry.assignments.some((item) => item.source === "auto"),
  };
};

// ---- 刪除人力需求 / 移除有人填的執行任務 ----

export interface ImpactTaskLike extends RosterTaskLike {
  taskKey: string;
  userId?: string | null;
  userName?: string | null;
}

export interface ImpactEntryLike {
  id: string;
  deletable: boolean;
  assignments: readonly { demandId: string; taskId: string }[];
}

/**
 * 移除人力需求的執行任務(或整筆刪除)會怎樣(規格 14.5 人力需求對話框):
 * `released` = 會解除的人;`deleted` = 解除後變成零筆、會一起刪的排班;
 * `blocked` = 其中已被收銀班次綁定、擋下要先改的排班。
 */
export const demandRemovalImpact = <
  Task extends ImpactTaskLike,
  Entry extends ImpactEntryLike,
>(
  demandId: string,
  removed: readonly Task[],
  entries: readonly Entry[],
): { released: Task[]; deleted: Entry[]; blocked: Entry[] } => {
  const released = removed.filter(
    (task) => task.entryId !== null && task.entryId !== undefined,
  );
  const removedIds = new Set(released.map((task) => task.taskId));
  const emptied = entries.filter(
    (entry) =>
      released.some((task) => task.entryId === entry.id) &&
      entry.assignments.every(
        (item) => item.demandId === demandId && removedIds.has(item.taskId),
      ),
  );
  return {
    released,
    deleted: emptied.filter((entry) => entry.deletable),
    blocked: emptied.filter((entry) => !entry.deletable),
  };
};
