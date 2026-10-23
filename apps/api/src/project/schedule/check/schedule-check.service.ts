import { Injectable, type OnModuleInit } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { Types } from "mongoose";

import { type InstantRange, parseLocalMonth } from "@repo/domain/form";
import type { ScheduleRuleLevel } from "@repo/domain/project/schedule-settings";

import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import {
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import { UnmatchedPunchesReader } from "../attendance/unmatched-punches";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import {
  DAY_OFF_PERSON_RULE_KEYS,
  DAY_OFF_STORE_RULE_KEY,
  type DayOffLike,
} from "../day-offs/day-off-rules";
import {
  ScheduleDayOffsService,
  type ScheduleUnavailability,
} from "../day-offs/schedule-day-offs.service";
import { type EntryRecord, RosterPeopleReader } from "../roster/roster-people";
import {
  type EffectiveRuleSetting,
  type ScheduleRuleViolation,
  ruleEvaluatorOf,
} from "../rules/rule-registry";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import {
  dateKeyOf,
  dayKeyRange,
  instantOfKey,
  instantRangeFilter,
  monthKeyRange,
} from "../shared/schedule-dates";
import { validationError } from "../shared/schedule-error";
import {
  type ScheduleOrg,
  loadOrgNames,
  resolveScheduleOrg,
} from "../shared/schedule-org";
import { compareScheduleNames } from "../shared/schedule-sort";
import { ScheduleStaffService } from "../staff/schedule-staff.service";
import type {
  ScheduleCheckItemModel,
  ScheduleCheckPayload,
} from "./models/schedule-check.model";
import {
  type BusyLike,
  UNDERSTAFFED_RULE_KEY,
  type WorkEntryLike,
  evaluatePersonWorkRules,
  limitSeverityByKey,
  registerRosterRuleEvaluators,
  widenedRange,
} from "./roster-rules";

/** 不屬於規則的檢核類別:畫休日有排班(先排班、後登記畫休;使用者 10/21 定案)。 */
export const DAY_OFF_ENTRY_CONFLICT_KEY = "dayOffEntryConflict";

/** 檢核類別「未對應排班的打卡」(規格 14.5:等級提醒,不影響發布;一人一天一項)。 */
export const UNMATCHED_PUNCHES_KEY = "unmatchedPunches";

/** 連續上班 / 休假、兩班之間的休息會跨月:前後各讀這麼多天。 */
const WIDEN_DAYS = 31;
/** 不屬於規則的類別排在規則後面。 */
const NON_RULE_ORDER = 10_000;

/**
 * 存排班被擋下(限制):`VALIDATION_FAILED`(欄位 `rules`)+ `extensions.violations`
 * (`from` / `to` = 期間的起訖日,各是那天租戶時區 00:00 的時點,含頭尾)。
 */
export function rosterRuleError(
  violations: readonly ScheduleRuleViolation[],
  timezone: string,
): GraphQLError {
  const instantOf = (key: string | undefined) =>
    key === undefined ? null : instantOfKey(key, timezone).toISOString();
  return new GraphQLError("schedule entry violates schedule rules", {
    extensions: {
      code: "VALIDATION_FAILED",
      fields: ["rules"],
      violations: violations.map((violation) => ({
        key: violation.key,
        level: violation.level,
        message: violation.message,
        actual: violation.detail?.actual ?? null,
        limit: violation.detail?.limit ?? null,
        from: instantOf(violation.detail?.from),
        to: instantOf(violation.detail?.to),
      })),
    },
  });
}

/** 一筆排班存檔前後(存排班時的規則檢查用;`date` 是租戶時區的日期鍵)。 */
export interface EntryRuleCheck {
  userId: Types.ObjectId;
  /** 修改的那一筆(新增 = null) */
  entryId: Types.ObjectId | null;
  before: { date: string; demandIds: readonly Types.ObjectId[] } | null;
  after: {
    date: string;
    startAt: Date;
    endAt: Date;
    breakMinutes: number;
    demandIds: readonly Types.ObjectId[];
  };
}

/**
 * 排班檢核(規格 14.2 等級、14.5「檢核面板」「發布」;正本 `docs/modules/project/schedule.md`「檢核與發布」):
 * `evaluateSchedule(operator, orgId, month)` 用**最新的生效設定**跑一家店一個月的所有規則
 * (排班類 + 畫休類,經 `registerRuleEvaluator` 的同一份登記),再加上「畫休日有排班」;
 * 檢核面板、發布、存排班都用它。
 *
 * - 人的規則用那個人**主要分店**的設定;只列出牽涉到這家店排班的違反(畫休類只列以這家店為主要分店的人)
 * - 人力不足用這家店的設定,店休那天的人力需求不檢查
 * - 排序:限制在前、提醒在後;同等級依規則排序(`order`)→ 日期 → 姓名
 */
@Injectable()
export class ScheduleCheckService implements OnModuleInit {
  constructor(
    private readonly demands: ScheduleDemandsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly assignments: ScheduleTaskAssignmentsRepository,
    private readonly orgs: OrgsRepository,
    private readonly staff: ScheduleStaffService,
    private readonly dayOffs: ScheduleDayOffsService,
    private readonly calendar: ScheduleCalendarService,
    private readonly rules: ScheduleRulesService,
    private readonly people: RosterPeopleReader,
    private readonly unmatched: UnmatchedPunchesReader,
  ) {}

  onModuleInit(): void {
    registerRosterRuleEvaluators();
  }

  async evaluateSchedule(
    operator: OperatorContext,
    orgId: string | null | undefined,
    month: string,
  ): Promise<ScheduleCheckPayload> {
    if (parseLocalMonth(month) === null) {
      throw validationError(`invalid month: ${month}`, ["month"]);
    }
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    return this.evaluateOrg(operator, org, month);
  }

  /** 同 `evaluateSchedule`,組織已解析(發布用)。 */
  async evaluateOrg(
    operator: OperatorContext,
    org: ScheduleOrg,
    month: string,
  ): Promise<ScheduleCheckPayload> {
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    const own = monthKeyRange(month, timezone);
    const keyOf = (date: Date) => dateKeyOf(date, timezone);
    const wide = widenedDays(own, timezone);
    const candidates = await this.staff.listScheduleCandidates(
      operator,
      org.id,
    );
    const storeEntries = await this.entries.findMany(
      operator,
      { orgId: org.id, date: instantRangeFilter(own) },
      { sort: { startAt: 1 } },
    );
    const demands = await this.demands.findMany(
      operator,
      { orgId: org.id, date: instantRangeFilter(own) },
      { sort: { startAt: 1 } },
    );
    const assignments =
      storeEntries.length === 0
        ? []
        : await this.assignments.findMany(operator, {
            orgId: org.id,
            entryId: { $in: storeEntries.map((entry) => entry._id) },
          });
    const storeSettings = await this.rules.effectiveSettingsForOrg(
      operator,
      org.id,
    );
    const calendarDays = await this.calendar.effectiveDays(
      operator,
      org.id,
      own,
    );
    const unavailability = await this.dayOffs.listUnavailable(
      operator,
      org.id,
      wide,
    );

    const candidateIds = candidates.map((candidate) => candidate.userId);
    const peopleIds = [
      ...new Set([
        ...candidateIds,
        ...storeEntries.map((entry) => String(entry.userId)),
      ]),
    ];
    const allEntries = await this.people.entriesOfPeople(
      operator,
      org.tenantId,
      peopleIds.map((id) => new Types.ObjectId(id)),
      wide,
    );
    const names = new Map([
      ...(await this.people.namesOf(peopleIds)),
      ...candidates.map(
        (candidate) => [candidate.userId, candidate.name] as const,
      ),
    ]);

    const demandById = new Map(
      demands.map((demand) => [String(demand._id), demand]),
    );
    const demandsOfEntry = (entryId: string) =>
      assignments
        .filter((item) => String(item.entryId) === entryId)
        .flatMap((item) => {
          const demand = demandById.get(String(item.demandId));
          return demand === undefined
            ? []
            : [
                {
                  demandId: String(demand._id),
                  startAt: demand.startAt,
                  endAt: demand.endAt,
                },
              ];
        });
    const storeEntryIds = new Set(
      storeEntries.map((entry) => String(entry._id)),
    );
    const workEntries: WorkEntryLike[] = allEntries.map((entry) =>
      workEntryOf(
        entry,
        storeEntryIds.has(String(entry._id))
          ? demandsOfEntry(String(entry._id))
          : [],
        timezone,
      ),
    );

    const violations: ScheduleRuleViolation[] = [];
    const tenantId = String(org.tenantId);

    // ---- 人的排班類規則(主要分店的設定;只列牽涉到這家店排班的) ----
    const settingsOf = await this.personSettings(org, storeSettings, peopleIds);
    for (const userId of new Set(
      storeEntries.map((entry) => String(entry.userId)),
    )) {
      const found = await evaluatePersonWorkRules({
        tenantId,
        orgId: String(org.id),
        settings: settingsOf(userId),
        person: { userId, month, entries: workEntries },
      });
      violations.push(
        ...found.filter((violation) =>
          violation.targets.some(
            (target) =>
              target.entryId !== undefined && storeEntryIds.has(target.entryId),
          ),
        ),
      );
    }

    // ---- 畫休類規則(以這家店為主要分店的人;同 P07 的算法) ----
    const primaryIds = new Set(
      candidates
        .filter((candidate) => candidate.isPrimary)
        .map((candidate) => candidate.userId),
    );
    const dayOffLikes = dayOffLikesOf(unavailability, timezone).filter((item) =>
      primaryIds.has(item.userId),
    );
    for (const userId of primaryIds) {
      for (const key of DAY_OFF_PERSON_RULE_KEYS) {
        violations.push(
          ...(await runRule(key, storeSettings, {
            tenantId,
            orgId: String(org.id),
            data: {
              userId,
              month,
              dayOffs: dayOffLikes.filter((item) => item.userId === userId),
            },
          })),
        );
      }
    }
    violations.push(
      ...(await runRule(DAY_OFF_STORE_RULE_KEY, storeSettings, {
        tenantId,
        orgId: String(org.id),
        data: { month, dayOffs: dayOffLikes },
      })),
    );

    // ---- 人力不足(這家店的設定;店休那天不檢查) ----
    const closed = new Set(
      calendarDays
        .filter((day) => day.type === "closed")
        .map((day) => keyOf(day.date)),
    );
    const entryById = new Map(
      storeEntries.map((entry) => [String(entry._id), entry]),
    );
    const filler = new Map(
      assignments.map((item) => [
        `${String(item.demandId)}|${item.taskId}`,
        entryById.get(String(item.entryId)),
      ]),
    );
    const busy: BusyLike[] = [
      ...allEntries.map((entry) => ({
        userId: String(entry.userId),
        kind: "entry" as const,
        startAt: entry.startAt,
        endAt: entry.endAt,
      })),
      ...busyOfUnavailability(unavailability, timezone),
    ];
    violations.push(
      ...(await runRule(UNDERSTAFFED_RULE_KEY, storeSettings, {
        tenantId,
        orgId: String(org.id),
        data: {
          month,
          demands: demands
            .filter((demand) => !closed.has(keyOf(demand.date)))
            .map((demand) => ({
              id: String(demand._id),
              date: keyOf(demand.date),
              startAt: demand.startAt,
              endAt: demand.endAt,
              tasks: demand.tasks.map((task) => {
                const entry = filler.get(
                  `${String(demand._id)}|${task.taskId}`,
                );
                return {
                  taskId: task.taskId,
                  role: task.role,
                  filledBy:
                    entry === undefined
                      ? null
                      : { startAt: entry.startAt, endAt: entry.endAt },
                };
              }),
            })),
          candidates: candidates.map((candidate) => ({
            userId: candidate.userId,
            canLead: candidate.canLead,
          })),
          busy,
        },
      })),
    );

    const items = violations.map((violation) =>
      itemOfViolation(violation, month, names, timezone),
    );

    // ---- 畫休日有排班(人 × 日,含跨店;看不到的分店不帶名稱) ----
    items.push(
      ...(await this.dayOffEntryConflicts(operator, org, {
        month: own,
        timezone,
        candidateIds: new Set(candidateIds),
        allEntries,
        busy: busyOfUnavailability(unavailability, timezone),
        names,
      })),
    );

    // ---- 未對應排班的打卡(提醒;人 × 日,這家店這個月打的卡) ----
    const punches = await this.unmatched.of(operator, org.id, timezone, own);
    const punchNames = await this.people.namesOf(
      punches.map((punch) => punch.userId),
    );
    const byPersonDay = new Map<string, typeof punches>();
    for (const punch of punches) {
      const key = `${punch.userId}|${String(punch.date.getTime())}`;
      byPersonDay.set(key, [...(byPersonDay.get(key) ?? []), punch]);
    }
    for (const list of byPersonDay.values()) {
      const [first] = list;
      if (first === undefined) {
        continue;
      }
      items.push({
        ...emptyItem(first.date),
        key: UNMATCHED_PUNCHES_KEY,
        level: "reminder",
        message: `${keyOf(first.date)} 有 ${String(list.length)} 張未對應排班的打卡`,
        userId: first.userId,
        userName:
          names.get(first.userId) ?? punchNames.get(first.userId) ?? null,
        actual: list.length,
      });
    }

    const orderOf = (key: string) =>
      storeSettings.get(key)?.order ?? NON_RULE_ORDER;
    const sorted = items.toSorted(
      (left, right) =>
        levelRank(left.level) - levelRank(right.level) ||
        orderOf(left.key) - orderOf(right.key) ||
        left.date.getTime() - right.date.getTime() ||
        compareScheduleNames(left.userName ?? "", right.userName ?? "") ||
        (left.startAt?.getTime() ?? 0) - (right.startAt?.getTime() ?? 0),
    );
    return {
      orgId: String(org.id),
      month,
      items: sorted,
      limitCount: sorted.filter((item) => item.level === "limit").length,
      reminderCount: sorted.filter((item) => item.level === "reminder").length,
    };
  }

  /**
   * 存排班時的規則檢查(規格 14.2「限制 → 不能存」):跑這個人的排班類規則(他主要分店的設定),
   * 存檔後限制的違反比存檔前嚴重 → 回存檔後的限制違反(呼叫端擋下);否則回空陣列。
   * 在寫入的交易內呼叫(讀到的是交易當下的排班)。
   */
  async limitViolationsOfEntry(
    operator: OperatorContext,
    org: ScheduleOrg,
    check: EntryRuleCheck,
  ): Promise<ScheduleRuleViolation[]> {
    const dates = [
      check.after.date,
      ...(check.before ? [check.before.date] : []),
    ];
    const sortedDates = dates.toSorted((left, right) =>
      left.localeCompare(right),
    );
    const first = sortedDates[0] ?? check.after.date;
    const last = sortedDates.at(-1) ?? check.after.date;
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    const wide = widenedRange(first, last, WIDEN_DAYS);
    const userId = String(check.userId);
    const records = await this.people.entriesOfPeople(
      operator,
      org.tenantId,
      [check.userId],
      dayKeyRange(wide.from, wide.to, timezone),
    );
    const demandIds = [
      ...check.after.demandIds,
      ...(check.before?.demandIds ?? []),
    ];
    const demands =
      demandIds.length === 0
        ? []
        : await this.demands.findMany(operator, {
            _id: { $in: demandIds },
          });
    const windowsOf = (ids: readonly Types.ObjectId[]) =>
      ids.flatMap((id) => {
        const demand = demands.find((item) => String(item._id) === String(id));
        return demand === undefined
          ? []
          : [
              {
                demandId: String(demand._id),
                startAt: demand.startAt,
                endAt: demand.endAt,
              },
            ];
      });
    const entryId = check.entryId === null ? null : String(check.entryId);
    const others = records
      .filter((record) => String(record._id) !== entryId)
      .map((record) => workEntryOf(record, [], timezone));
    const existing = records.find((record) => String(record._id) === entryId);
    const beforeEntries =
      existing === undefined
        ? others
        : [
            ...others,
            workEntryOf(
              existing,
              windowsOf(check.before?.demandIds ?? []),
              timezone,
            ),
          ];
    const afterEntries: WorkEntryLike[] = [
      ...others,
      {
        id: entryId ?? "new",
        userId,
        orgId: String(org.id),
        date: check.after.date,
        startAt: check.after.startAt,
        endAt: check.after.endAt,
        breakMinutes: check.after.breakMinutes,
        demands: windowsOf(check.after.demandIds),
      },
    ];
    const settings = (await this.personSettings(org, null, [userId]))(userId);
    const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
    const evaluate = async (entries: WorkEntryLike[]) => {
      const found: ScheduleRuleViolation[] = [];
      for (const month of months) {
        found.push(
          ...(await evaluatePersonWorkRules({
            tenantId: String(org.tenantId),
            orgId: String(org.id),
            settings,
            person: { userId, month, entries },
          })),
        );
      }
      return found;
    };
    const beforeViolations = await evaluate(beforeEntries);
    const before = limitSeverityByKey(beforeViolations);
    const afterViolations = await evaluate(afterEntries);
    const worse = new Set(
      [...limitSeverityByKey(afterViolations)]
        .filter(([key, amount]) => amount > (before.get(key) ?? 0) + 1e-9)
        .map(([key]) => key),
    );
    const blocking = afterViolations.filter(
      (violation) => violation.level === "limit" && worse.has(violation.key),
    );
    // 列出這次存檔造成的(存檔前就有的同一筆違反不列);全是既有的變嚴重時照列
    const known = new Set(
      beforeViolations.map((violation) => signatureOf(violation)),
    );
    const caused = blocking.filter(
      (violation) => !known.has(signatureOf(violation)),
    );
    return caused.length > 0 ? caused : blocking;
  }

  /**
   * 每個人的規則設定(人的規則用他主要分店的設定;沒有主要分店用這家店的)。
   * 主要分店不一定在操作者的可見範圍:以租戶為邊界讀它的生效設定(同畫休)。
   */
  async personSettings(
    org: ScheduleOrg,
    storeSettings: ReadonlyMap<string, EffectiveRuleSetting> | null,
    userIds: readonly string[],
  ): Promise<(userId: string) => ReadonlyMap<string, EffectiveRuleSetting>> {
    const reader = await tenantBoundaryContext(this.orgs, null, org.tenantId);
    const own =
      storeSettings ??
      (await this.rules.effectiveSettingsForOrg(reader, org.id));
    const primary = await this.dayOffs.primaryOrgsOf(org.tenantId, userIds);
    const byOrg = new Map<string, ReadonlyMap<string, EffectiveRuleSetting>>([
      [String(org.id), own],
    ]);
    for (const orgId of new Set(primary.values())) {
      if (!byOrg.has(String(orgId))) {
        byOrg.set(
          String(orgId),
          await this.rules.effectiveSettingsForOrg(reader, orgId),
        );
      }
    }
    return (userId) => {
      const orgId = primary.get(userId);
      return (
        (orgId === undefined ? undefined : byOrg.get(String(orgId))) ?? own
      );
    };
  }

  /** 可以排這家店的人,這個月的排班(任何分店)碰到他的畫休(整天,或和時段不可排重疊)。 */
  private async dayOffEntryConflicts(
    operator: OperatorContext,
    org: ScheduleOrg,
    input: {
      /** 這個月的時點區間 */
      month: InstantRange;
      timezone: string;
      candidateIds: ReadonlySet<string>;
      allEntries: readonly EntryRecord[];
      busy: readonly BusyLike[];
      names: ReadonlyMap<string, string>;
    },
  ): Promise<ScheduleCheckItemModel[]> {
    const conflicts = input.allEntries.filter(
      (entry) =>
        entry.date.getTime() >= input.month.from &&
        entry.date.getTime() < input.month.to &&
        input.candidateIds.has(String(entry.userId)) &&
        input.busy.some(
          (item) =>
            item.userId === String(entry.userId) &&
            item.startAt.getTime() < entry.endAt.getTime() &&
            item.endAt.getTime() > entry.startAt.getTime(),
        ),
    );
    const otherOrgNames = await loadOrgNames(
      operator,
      this.orgs,
      conflicts
        .map((entry) => entry.orgId)
        .filter(
          (orgId) =>
            String(orgId) !== String(org.id) && isOrgVisible(operator, orgId),
        ),
    );
    return conflicts.map((entry) => {
      const isOtherStore = String(entry.orgId) !== String(org.id);
      const userId = String(entry.userId);
      return {
        ...emptyItem(entry.date),
        key: DAY_OFF_ENTRY_CONFLICT_KEY,
        level: "reminder",
        message: `${dateKeyOf(entry.date, input.timezone)} 畫休日有排班`,
        userId,
        userName: input.names.get(userId) ?? null,
        entryIds: [String(entry._id)],
        startAt: entry.startAt,
        endAt: entry.endAt,
        isOtherStore,
        orgName: isOtherStore
          ? (otherOrgNames.get(String(entry.orgId)) ?? null)
          : org.name,
      };
    });
  }
}

/** 檢核項目(模型的純物件形狀)。 */
type CheckItem = Pick<ScheduleCheckItemModel, keyof ScheduleCheckItemModel>;

const signatureOf = (violation: ScheduleRuleViolation) =>
  [
    violation.key,
    violation.detail?.from ?? "",
    violation.detail?.to ?? "",
    String(violation.detail?.actual ?? ""),
  ].join("|");

const levelRank = (level: string) => (level === "limit" ? 0 : 1);

/** 規則運算吃的排班(`date` = 租戶時區的日期鍵)。 */
function workEntryOf(
  entry: EntryRecord,
  demands: WorkEntryLike["demands"],
  timezone: string,
): WorkEntryLike {
  return {
    id: String(entry._id),
    userId: String(entry.userId),
    orgId: String(entry.orgId),
    date: dateKeyOf(entry.date, timezone),
    startAt: entry.startAt,
    endAt: entry.endAt,
    breakMinutes: entry.breakMinutes,
    demands,
  };
}

/** 畫休(每天一列)→ 畫休規則吃的一段一筆(整天一筆、時段不可排每段一筆;`date` = 日期鍵)。 */
function dayOffLikesOf(
  unavailability: readonly ScheduleUnavailability[],
  timezone: string,
): DayOffLike[] {
  return unavailability.flatMap((day) => {
    const date = dateKeyOf(day.date, timezone);
    return [
      ...(day.fullDay ? [{ userId: day.userId, date, kind: "full-day" }] : []),
      ...day.slots.map(() => ({
        userId: day.userId,
        date,
        kind: "time-range",
      })),
    ];
  });
}

/** 這個月前後各讀 `WIDEN_DAYS` 天(連續上班 / 休假、兩班之間的休息會跨月)。 */
function widenedDays(month: InstantRange, timezone: string): InstantRange {
  const wide = widenedRange(
    dateKeyOf(month.from, timezone),
    dateKeyOf(month.to - 1, timezone),
    WIDEN_DAYS,
  );
  return dayKeyRange(wide.from, wide.to, timezone);
}

/**
 * 畫休 → 不能排的時點區間:整天 = 租戶時區那天 00:00 到隔天 00:00(`localDayRange`);
 * 時段不可排本身就是時點。
 */
export function busyOfUnavailability(
  unavailability: readonly ScheduleUnavailability[],
  timezone: string,
): BusyLike[] {
  return unavailability.flatMap((day) => {
    const key = dateKeyOf(day.date, timezone);
    const whole = dayKeyRange(key, key, timezone);
    return [
      ...(day.fullDay
        ? [
            {
              userId: day.userId,
              kind: "full-day" as const,
              startAt: new Date(whole.from),
              endAt: new Date(whole.to),
            },
          ]
        : []),
      ...day.slots.map((slot) => ({
        userId: day.userId,
        kind: "time-range" as const,
        startAt: slot.startAt,
        endAt: slot.endAt,
      })),
    ];
  });
}

async function runRule(
  key: string,
  settings: ReadonlyMap<string, EffectiveRuleSetting>,
  context: { tenantId: string; orgId: string; data: unknown },
): Promise<ScheduleRuleViolation[]> {
  const setting = settings.get(key);
  const evaluator = ruleEvaluatorOf(key);
  if (setting === undefined || evaluator === null) {
    return [];
  }
  return evaluator({ ...context, setting });
}

/** 空的檢核項目;`date` = [查看] 要捲到的那一天(租戶時區 00:00 的時點)。 */
function emptyItem(date: Date): CheckItem {
  return {
    key: "",
    level: "reminder",
    message: "",
    userId: null,
    userName: null,
    date,
    entryIds: [],
    actual: null,
    limit: null,
    from: null,
    to: null,
    startAt: null,
    endAt: null,
    isOtherStore: false,
    orgName: null,
    understaffed: null,
  };
}

function itemOfViolation(
  violation: ScheduleRuleViolation,
  month: string,
  names: ReadonlyMap<string, string>,
  timezone: string,
): ScheduleCheckItemModel {
  const userId =
    violation.targets.find((target) => target.userId !== undefined)?.userId ??
    null;
  const date =
    violation.targets.find(
      (target) => target.date?.startsWith(`${month}-`) === true,
    )?.date ??
    violation.detail?.from ??
    `${month}-01`;
  const level: ScheduleRuleLevel = violation.level;
  const from = violation.detail?.from;
  const to = violation.detail?.to;
  return {
    ...emptyItem(
      instantOfKey(
        date.startsWith(`${month}-`) ? date : `${month}-01`,
        timezone,
      ),
    ),
    key: violation.key,
    level,
    message: violation.message,
    userId,
    userName: userId === null ? null : (names.get(userId) ?? null),
    entryIds: [
      ...new Set(
        violation.targets.flatMap((target) =>
          target.entryId === undefined ? [] : [target.entryId],
        ),
      ),
    ],
    actual: violation.detail?.actual ?? null,
    limit: violation.detail?.limit ?? null,
    from: from === undefined ? null : instantOfKey(from, timezone),
    to: to === undefined ? null : instantOfKey(to, timezone),
    startAt: violation.detail?.startAt ?? null,
    endAt: violation.detail?.endAt ?? null,
    understaffed: violation.detail?.understaffed ?? null,
  };
}
