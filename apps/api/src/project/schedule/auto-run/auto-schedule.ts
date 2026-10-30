import { COLLATION_LOCALE } from "@repo/domain/collation";
import {
  type ScheduleAutoRunSortCondition,
  type ScheduleBreakTier,
  defaultBreakMinutes,
} from "@repo/domain/project/schedule-settings";

import {
  type PersonWorkData,
  type WorkEntryLike,
  limitSeverityByKey,
  maxConsecutiveWorkDaysEvaluator,
  maxDailyWorkHoursEvaluator,
  minRestBetweenShiftsEvaluator,
  multiPositionOverlapEvaluator,
} from "../check/roster-rules";
import type {
  EffectiveRuleSetting,
  ScheduleRuleEvaluator,
  ScheduleRuleViolation,
} from "../rules/rule-registry";
import { isDateKeyInMonth, monthKeyOf } from "../shared/schedule-dates";
import { seededRandom } from "./seeded-random";

/**
 * 自動排班的演算法版本(規格 14.5「同時記錄演算法版本」;記在 `schedule_auto_runs.algorithmVersion`)。
 * 改了處理順序、排序鍵、亂數的取法或可排的判斷 → 版本加 1(同一個種子在不同版本可能排出不同結果)。
 */
export const SCHEDULE_AUTO_RUN_ALGORITHM_VERSION = "1";

/** 一筆排班最長 24 小時(同手動)。 */
const MAX_SPAN_MS = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60_000;

/** 要填的人力需求(這家店、範圍內、不是店休那天)。 */
export interface AutoDemand {
  id: string;
  date: string;
  startAt: Date;
  endAt: Date;
  tasks: readonly { taskId: string; role: string }[];
}

/** 候選人既有的排班(任何分店;前後各一個月,規則會跨月)。 */
export interface AutoEntry {
  id: string;
  userId: string;
  orgId: string;
  date: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
}

/** 這家店既有的填進紀錄(清除之後留下的)。 */
export interface AutoAssignment {
  entryId: string;
  demandId: string;
  taskId: string;
}

export interface AutoCandidate {
  userId: string;
  canLead: boolean;
}

/** 不能排的時間(整天畫休 = 當天 00:00 到隔天 00:00、時段不可排)。 */
export interface AutoBusy {
  userId: string;
  startAt: Date;
  endAt: Date;
}

export interface AutoScheduleInput {
  storeId: string;
  /** `YYYY-MM`(本月班數、規則的月份) */
  month: string;
  seed: number;
  /** 要填的人力需求 */
  demands: readonly AutoDemand[];
  /** 這家店其他人力需求(既有排班填進的;兼多個崗位要它們的時間) */
  otherDemands: readonly AutoDemand[];
  entries: readonly AutoEntry[];
  assignments: readonly AutoAssignment[];
  /** 可以排這家店的人 */
  candidates: readonly AutoCandidate[];
  busy: readonly AutoBusy[];
  /** 店休的日子(排班碰到就不能排,跨午夜含隔天) */
  closedDates: ReadonlySet<string>;
  /** 勾選的排序條件(依勾選順序) */
  sortConditions: readonly ScheduleAutoRunSortCondition[];
  /** 允許同一人同時段填進多筆人力需求 */
  allowOverlap: boolean;
  /** 過去 90 天在這家店擔任負責人的次數(以排班為單位) */
  leaderCounts: ReadonlyMap<string, number>;
  /** 規則「預設休息」 */
  breakTiers: readonly ScheduleBreakTier[];
  /** 這個人的規則生效設定(人的規則用主要分店的設定) */
  settingsOf: (userId: string) => ReadonlyMap<string, EffectiveRuleSetting>;
  /** 時點 → 租戶當地日期 `YYYY-MM-DD` */
  dateOf: (at: Date) => string;
}

/** 新建的排班(`key` = `new:<n>`,填進紀錄以它指回)。 */
export interface AutoNewEntry {
  key: string;
  userId: string;
  date: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
}

/** 延長的既有排班(延續同一人的排班)。 */
export interface AutoChangedEntry {
  entryId: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
}

export interface AutoFill {
  /** 既有排班 id 或新排班的 `key` */
  entryKey: string;
  demandId: string;
  taskId: string;
  /** 自動排入的理由(給人看,長條滑過提示) */
  reason: string;
}

export interface AutoScheduleResult {
  newEntries: AutoNewEntry[];
  changedEntries: AutoChangedEntry[];
  fills: AutoFill[];
  /** 排不滿的執行任務筆數(檢核的「人力不足」會列出原因) */
  unfilledCount: number;
}

/** 自動排入理由(依決定勝負的那個條件)。 */
export const AUTO_FILL_REASONS: Record<
  ScheduleAutoRunSortCondition | "random" | "randomTie" | "only",
  string
> = {
  continuePreviousEntry: "自動排入:延續同一人的排班",
  leaderCountFirst: "自動排入:負責人次數較多",
  monthlyShiftBalance: "自動排入:本月班數較少",
  randomTie: "自動排入:條件平手,隨機",
  random: "自動排入:隨機",
  only: "自動排入:唯一可排的人",
};

/** 模擬中的一筆排班。 */
interface SimEntry {
  key: string;
  userId: string;
  orgId: string;
  date: string;
  startAt: number;
  endAt: number;
  breakMinutes: number;
  /** 這家店填進的人力需求 */
  demandIds: Set<string>;
  isNew: boolean;
  changed: boolean;
}

/** 一位候選人可以怎麼排這一筆。 */
interface Option {
  userId: string;
  /** 併進的既有排班(null = 新建一筆) */
  base: SimEntry | null;
  startAt: number;
  endAt: number;
  breakMinutes: number;
  continuing: boolean;
  leaderCount: number;
  shiftCount: number;
  random: number;
}

const PERSON_EVALUATORS: readonly [
  string,
  ScheduleRuleEvaluator<PersonWorkData>,
][] = [
  ["maxConsecutiveWorkDays", maxConsecutiveWorkDaysEvaluator],
  ["minRestBetweenShifts", minRestBetweenShiftsEvaluator],
  ["maxDailyWorkHours", maxDailyWorkHoursEvaluator],
  ["multiPositionOverlap", multiPositionOverlapEvaluator],
];

const overlaps = (
  left: { startAt: number; endAt: number },
  right: { startAt: number; endAt: number },
) => left.startAt < right.endAt && left.endAt > right.startAt;

const SORT_COMPARATORS: Record<
  ScheduleAutoRunSortCondition,
  (left: Option, right: Option) => number
> = {
  continuePreviousEntry: (left, right) =>
    Number(right.continuing) - Number(left.continuing),
  leaderCountFirst: (left, right) => right.leaderCount - left.leaderCount,
  monthlyShiftBalance: (left, right) => left.shiftCount - right.shiftCount,
};

type FillReasonKey = keyof typeof AUTO_FILL_REASONS;

/** 決定勝負的那個條件(只有一位 → `only`;全部平手 → 亂數)。 */
function decisiveOf(
  conditions: readonly ScheduleAutoRunSortCondition[],
  winner: Option,
  runnerUp: Option | undefined,
): FillReasonKey {
  if (runnerUp === undefined) {
    return "only";
  }
  const found = conditions.find(
    (condition) => SORT_COMPARATORS[condition](winner, runnerUp) !== 0,
  );
  if (found !== undefined) {
    return found;
  }
  return conditions.length === 0 ? "random" : "randomTie";
}

function sortOptions(
  options: readonly Option[],
  conditions: readonly ScheduleAutoRunSortCondition[],
): Option[] {
  return options.toSorted((left, right) => {
    for (const condition of conditions) {
      const order = SORT_COMPARATORS[condition](left, right);
      if (order !== 0) {
        return order;
      }
    }
    return left.random - right.random;
  });
}

function workEntryOf(
  entry: SimEntry,
  demandById: ReadonlyMap<string, AutoDemand>,
): WorkEntryLike {
  return {
    id: entry.key,
    userId: entry.userId,
    orgId: entry.orgId,
    date: entry.date,
    startAt: new Date(entry.startAt),
    endAt: new Date(entry.endAt),
    breakMinutes: entry.breakMinutes,
    demands: windowsOf([...entry.demandIds], demandById),
  };
}

function windowsOf(
  demandIds: readonly string[],
  demandById: ReadonlyMap<string, AutoDemand>,
): WorkEntryLike["demands"] {
  return demandIds.flatMap((demandId) => {
    const demand = demandById.get(demandId);
    return demand === undefined
      ? []
      : [{ demandId, startAt: demand.startAt, endAt: demand.endAt }];
  });
}

const spanOf = (demand: AutoDemand) => ({
  startAt: demand.startAt.getTime(),
  endAt: demand.endAt.getTime(),
});

/** 一位候選人併進 / 新建後的排班時間(還沒檢查可不可排)。 */
interface Placement {
  base: SimEntry | null;
  startAt: number;
  endAt: number;
  breakMinutes: number;
}

/**
 * 自動排班的核心(規格 14.5「自動排班」;同樣的輸入 + 種子一定排出同樣的結果)。
 *
 * - **處理順序固定**:人力需求依日期 → 開始時間 → id;同一筆裡負責人任務先、協同依陣列順序;
 *   候選人依 userId。每一筆任務對每位候選人(依 userId)各抽一個亂數,抽的次數不受誰可排影響
 * - **一定遵守**:畫休(整天或時段不可排)、店休、限制等級的人的規則(存檔後限制的違反不能比存檔前嚴重,
 *   同手動存排班)、一筆只填一人、負責任務只給可擔任負責人的人、同一人同一時間只有一筆排班(跨店也算)
 * - **兼多個崗位**:沒勾 `allowOverlap` 時,同一筆排班不會填進時間重疊的兩筆人力需求
 * - 候選人在這家店有**相接或重疊、同一天**的排班 → 併進那筆(必要時延長上下班時間);否則新建一筆
 *   (時間 = 人力需求的時間,休息依規則「預設休息」)
 * - **排序**:依勾選的排序條件組成字典序 —— 延續(併進既有排班的先)、負責人次數(只比負責任務,多者先)、
 *   本月班數(這家店本月,含這次排進的,少者先);全部平手看亂數
 */
export function autoSchedule(input: AutoScheduleInput): AutoScheduleResult {
  return new AutoScheduler(input).run();
}

class AutoScheduler {
  private readonly random: () => number;
  private readonly demandById: Map<string, AutoDemand>;
  private readonly entries: SimEntry[];
  private readonly taken = new Set<string>();
  private readonly candidates: AutoCandidate[];
  private readonly shiftCounts = new Map<string, number>();
  private readonly busyOf = new Map<string, AutoBusy[]>();
  private newSequence = 0;
  private unfilledCount = 0;
  private readonly fills: AutoFill[] = [];

  constructor(private readonly input: AutoScheduleInput) {
    this.random = seededRandom(input.seed);
    this.demandById = new Map(
      [...input.otherDemands, ...input.demands].map((demand) => [
        demand.id,
        demand,
      ]),
    );
    this.entries = input.entries.map((entry) => ({
      key: entry.id,
      userId: entry.userId,
      orgId: entry.orgId,
      date: entry.date,
      startAt: entry.startAt.getTime(),
      endAt: entry.endAt.getTime(),
      breakMinutes: entry.breakMinutes,
      demandIds: new Set(),
      isNew: false,
      changed: false,
    }));
    const entryByKey = new Map(this.entries.map((entry) => [entry.key, entry]));
    for (const item of input.assignments) {
      entryByKey.get(item.entryId)?.demandIds.add(item.demandId);
      this.taken.add(`${item.demandId}|${item.taskId}`);
    }
    this.candidates = input.candidates.toSorted((left, right) =>
      left.userId.localeCompare(right.userId, COLLATION_LOCALE),
    );
    for (const entry of this.entries) {
      if (this.isStore(entry) && isDateKeyInMonth(entry.date, input.month)) {
        this.bumpShift(entry.userId);
      }
    }
    for (const item of input.busy) {
      this.busyOf.set(item.userId, [
        ...(this.busyOf.get(item.userId) ?? []),
        item,
      ]);
    }
  }

  run(): AutoScheduleResult {
    const demands = this.input.demands.toSorted(
      (left, right) =>
        left.date.localeCompare(right.date, COLLATION_LOCALE) ||
        left.startAt.getTime() - right.startAt.getTime() ||
        left.id.localeCompare(right.id, COLLATION_LOCALE),
    );
    for (const demand of demands) {
      const tasks = [
        ...demand.tasks.filter((task) => task.role === "leader"),
        ...demand.tasks.filter((task) => task.role !== "leader"),
      ];
      for (const task of tasks) {
        this.fillTask(demand, task);
      }
    }
    return {
      newEntries: this.entries
        .filter((entry) => entry.isNew)
        .map((entry) => ({
          key: entry.key,
          userId: entry.userId,
          date: entry.date,
          startAt: new Date(entry.startAt),
          endAt: new Date(entry.endAt),
          breakMinutes: entry.breakMinutes,
        })),
      changedEntries: this.entries
        .filter((entry) => !entry.isNew && entry.changed)
        .map((entry) => ({
          entryId: entry.key,
          startAt: new Date(entry.startAt),
          endAt: new Date(entry.endAt),
          breakMinutes: entry.breakMinutes,
        })),
      fills: this.fills,
      unfilledCount: this.unfilledCount,
    };
  }

  private fillTask(
    demand: AutoDemand,
    task: { taskId: string; role: string },
  ): void {
    // 每一筆任務都對每位候選人抽一次(已經有人填的也抽),亂數序列不受資料變化影響
    const draws = this.candidates.map(() => this.random());
    const taskKey = `${demand.id}|${task.taskId}`;
    if (this.taken.has(taskKey)) {
      return;
    }
    const options = this.candidates.flatMap((candidate, index) => {
      const option = this.optionOf(
        candidate,
        demand,
        task.role,
        draws[index] ?? 0,
      );
      return option === null ? [] : [option];
    });
    const [winner, runnerUp] = sortOptions(options, this.input.sortConditions);
    if (winner === undefined) {
      this.unfilledCount += 1;
      return;
    }
    const decisive = decisiveOf(this.input.sortConditions, winner, runnerUp);
    const target = this.place(winner, demand);
    target.demandIds.add(demand.id);
    this.taken.add(taskKey);
    this.fills.push({
      entryKey: target.key,
      demandId: demand.id,
      taskId: task.taskId,
      reason: AUTO_FILL_REASONS[decisive],
    });
  }

  /** 把勝出的人排進去:新建一筆或延長併進的那筆。 */
  private place(winner: Option, demand: AutoDemand): SimEntry {
    const base = winner.base;
    if (base === null) {
      this.newSequence += 1;
      const created: SimEntry = {
        key: `new:${String(this.newSequence)}`,
        userId: winner.userId,
        orgId: this.input.storeId,
        date: demand.date,
        startAt: winner.startAt,
        endAt: winner.endAt,
        breakMinutes: winner.breakMinutes,
        demandIds: new Set(),
        isNew: true,
        changed: false,
      };
      this.entries.push(created);
      this.bumpShift(winner.userId);
      return created;
    }
    if (
      base.startAt !== winner.startAt ||
      base.endAt !== winner.endAt ||
      base.breakMinutes !== winner.breakMinutes
    ) {
      base.startAt = winner.startAt;
      base.endAt = winner.endAt;
      base.breakMinutes = winner.breakMinutes;
      base.changed = true;
    }
    return base;
  }

  /** 這位候選人可以怎麼排這一筆任務;不能排 → null。 */
  private optionOf(
    candidate: AutoCandidate,
    demand: AutoDemand,
    role: string,
    draw: number,
  ): Option | null {
    if (role === "leader" && !candidate.canLead) {
      return null;
    }
    const own = this.entries.filter(
      (entry) => entry.userId === candidate.userId,
    );
    if (own.some((entry) => entry.demandIds.has(demand.id))) {
      return null;
    }
    const placement = this.placementOf(own, demand);
    if (placement === null || !this.isFree(candidate.userId, own, placement)) {
      return null;
    }
    const option: Option = {
      userId: candidate.userId,
      ...placement,
      continuing: placement.base !== null,
      leaderCount:
        role === "leader"
          ? (this.input.leaderCounts.get(candidate.userId) ?? 0)
          : 0,
      shiftCount: this.shiftCounts.get(candidate.userId) ?? 0,
      random: draw,
    };
    return this.worsensLimits(option, demand) ? null : option;
  }

  /** 併進這家店相接或重疊、同一天的那筆排班(只能有一筆),或新建一筆。 */
  private placementOf(
    own: readonly SimEntry[],
    demand: AutoDemand,
  ): Placement | null {
    const window = spanOf(demand);
    const touching = own.filter(
      (entry) =>
        this.isStore(entry) &&
        entry.startAt <= window.endAt &&
        entry.endAt >= window.startAt,
    );
    const [base, extra] = touching;
    if (extra !== undefined) {
      return null;
    }
    if (base === undefined) {
      return {
        base: null,
        ...window,
        breakMinutes: this.breakOf(window.startAt, window.endAt),
      };
    }
    if (base.date !== demand.date || this.wouldStack(base, window)) {
      return null;
    }
    const startAt = Math.min(base.startAt, window.startAt);
    const endAt = Math.max(base.endAt, window.endAt);
    if (this.input.dateOf(new Date(startAt)) !== demand.date) {
      return null;
    }
    return {
      base,
      startAt,
      endAt,
      breakMinutes: Math.max(base.breakMinutes, this.breakOf(startAt, endAt)),
    };
  }

  /** 沒勾「允許同一人同時段填進多筆」時,同一筆排班不填進時間重疊的兩筆人力需求。 */
  private wouldStack(
    base: SimEntry,
    window: { startAt: number; endAt: number },
  ): boolean {
    if (this.input.allowOverlap) {
      return false;
    }
    return [...base.demandIds].some((demandId) => {
      const other = this.demandById.get(demandId);
      return other !== undefined && overlaps(window, spanOf(other));
    });
  }

  /** 時長、休息、和自己其他排班(跨店)、畫休、店休都沒衝突。 */
  private isFree(
    userId: string,
    own: readonly SimEntry[],
    placement: Placement,
  ): boolean {
    const span = { startAt: placement.startAt, endAt: placement.endAt };
    const length = span.endAt - span.startAt;
    if (
      length > MAX_SPAN_MS ||
      placement.breakMinutes * MS_PER_MINUTE >= length
    ) {
      return false;
    }
    if (
      own.some((entry) => entry !== placement.base && overlaps(entry, span))
    ) {
      return false;
    }
    const busy = this.busyOf.get(userId) ?? [];
    if (
      busy.some((item) =>
        overlaps(span, {
          startAt: item.startAt.getTime(),
          endAt: item.endAt.getTime(),
        }),
      )
    ) {
      return false;
    }
    const { closedDates, dateOf } = this.input;
    return (
      !closedDates.has(dateOf(new Date(span.startAt))) &&
      !closedDates.has(dateOf(new Date(span.endAt - 1)))
    );
  }

  /** 排進去之後,這個人限制等級的違反比排之前嚴重(同手動存排班的判斷)。 */
  private worsensLimits(option: Option, demand: AutoDemand): boolean {
    const months = [monthKeyOf(demand.date)];
    const before = this.severityOf(
      option.userId,
      months,
      this.workEntriesOf(option.userId, null, null),
    );
    const proposed: WorkEntryLike = {
      id: option.base?.key ?? "proposed",
      userId: option.userId,
      orgId: this.input.storeId,
      date: demand.date,
      startAt: new Date(option.startAt),
      endAt: new Date(option.endAt),
      breakMinutes: option.breakMinutes,
      demands: windowsOf(
        [...(option.base?.demandIds ?? []), demand.id],
        this.demandById,
      ),
    };
    const after = this.severityOf(
      option.userId,
      months,
      this.workEntriesOf(option.userId, option.base, proposed),
    );
    return [...after].some(
      ([key, amount]) => amount > (before.get(key) ?? 0) + 1e-9,
    );
  }

  private workEntriesOf(
    userId: string,
    replaced: SimEntry | null,
    proposed: WorkEntryLike | null,
  ): WorkEntryLike[] {
    return [
      ...this.entries
        .filter((entry) => entry.userId === userId && entry !== replaced)
        .map((entry) => workEntryOf(entry, this.demandById)),
      ...(proposed === null ? [] : [proposed]),
    ];
  }

  private severityOf(
    userId: string,
    months: readonly string[],
    entries: WorkEntryLike[],
  ): Map<string, number> {
    const settings = this.input.settingsOf(userId);
    const found: ScheduleRuleViolation[] = [];
    for (const month of months) {
      for (const [key, evaluator] of PERSON_EVALUATORS) {
        const setting = settings.get(key);
        if (setting?.level !== "limit") {
          continue;
        }
        const data: PersonWorkData = { userId, month, entries };
        found.push(
          ...(evaluator({
            tenantId: "",
            orgId: this.input.storeId,
            setting,
            data,
          }) as ScheduleRuleViolation[]),
        );
      }
    }
    return limitSeverityByKey(found);
  }

  private breakOf(startAt: number, endAt: number): number {
    return defaultBreakMinutes(
      this.input.breakTiers,
      (endAt - startAt) / MS_PER_MINUTE,
    );
  }

  private isStore(entry: SimEntry): boolean {
    return entry.orgId === this.input.storeId;
  }

  private bumpShift(userId: string): void {
    this.shiftCounts.set(userId, (this.shiftCounts.get(userId) ?? 0) + 1);
  }
}
