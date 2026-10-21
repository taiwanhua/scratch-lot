import { Injectable, type OnModuleInit } from "@nestjs/common";
import { GraphQLError } from "graphql";
import { Types } from "mongoose";

import {
  addLocalCalendar,
  instantOfLocalTime,
  parseLocalDate,
} from "@repo/domain/form";
import {
  type ScheduleRuleLevel,
  isIsoMonth,
  minutesOfHhMm,
} from "@repo/domain/project/schedule-settings";

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
import { monthRange } from "../roster/schedule-roster.service";
import {
  type EffectiveRuleSetting,
  type ScheduleRuleViolation,
  ruleEvaluatorOf,
} from "../rules/rule-registry";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
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

/** 存排班被擋下(限制):`VALIDATION_FAILED`(欄位 `rules`)+ `extensions.violations`。 */
export function rosterRuleError(
  violations: readonly ScheduleRuleViolation[],
): GraphQLError {
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
        from: violation.detail?.from ?? null,
        to: violation.detail?.to ?? null,
      })),
    },
  });
}

/** 一筆排班存檔前後(存排班時的規則檢查用)。 */
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
    if (!isIsoMonth(month)) {
      throw validationError(`invalid month: ${String(month)}`, ["month"]);
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
    const { from, to } = monthRange(month);
    const wide = widenedRange(from, to, WIDEN_DAYS);
    const candidates = await this.staff.listScheduleCandidates(
      operator,
      org.id,
    );
    const storeEntries = await this.entries.findMany(
      operator,
      { orgId: org.id, date: { $gte: from, $lte: to } },
      { sort: { startAt: 1 } },
    );
    const demands = await this.demands.findMany(
      operator,
      { orgId: org.id, date: { $gte: from, $lte: to } },
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
      from,
      to,
    );
    const unavailability = await this.dayOffs.listUnavailable(
      operator,
      org.id,
      wide.from,
      wide.to,
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
      wide.from,
      wide.to,
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
    const dayOffLikes = dayOffLikesOf(unavailability).filter((item) =>
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
      calendarDays.filter((day) => day.type === "closed").map((d) => d.date),
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
            .filter((demand) => !closed.has(demand.date))
            .map((demand) => ({
              id: String(demand._id),
              date: demand.date,
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
      itemOfViolation(violation, month, names),
    );

    // ---- 畫休日有排班(人 × 日,含跨店;看不到的分店不帶名稱) ----
    items.push(
      ...(await this.dayOffEntryConflicts(operator, org, {
        month,
        candidateIds: new Set(candidateIds),
        allEntries,
        busy: busyOfUnavailability(unavailability, timezone),
        names,
      })),
    );

    // ---- 未對應排班的打卡(提醒;人 × 日,這家店這個月打的卡) ----
    const punches = await this.unmatched.of(operator, org.id, timezone, {
      from,
      to,
    });
    const punchNames = await this.people.namesOf(
      punches.map((punch) => punch.userId),
    );
    const byPersonDay = new Map<string, typeof punches>();
    for (const punch of punches) {
      const key = `${punch.userId}|${punch.date}`;
      byPersonDay.set(key, [...(byPersonDay.get(key) ?? []), punch]);
    }
    for (const list of byPersonDay.values()) {
      const [first] = list;
      if (first === undefined) {
        continue;
      }
      items.push({
        ...emptyItem(),
        key: UNMATCHED_PUNCHES_KEY,
        level: "reminder",
        message: `${first.date} 有 ${String(list.length)} 張未對應排班的打卡`,
        userId: first.userId,
        userName:
          names.get(first.userId) ?? punchNames.get(first.userId) ?? null,
        date: first.date,
        actual: list.length,
      });
    }

    const orderOf = (key: string) =>
      storeSettings.get(key)?.order ?? NON_RULE_ORDER;
    const sorted = items.toSorted(
      (left, right) =>
        levelRank(left.level) - levelRank(right.level) ||
        orderOf(left.key) - orderOf(right.key) ||
        left.date.localeCompare(right.date) ||
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
    const wide = widenedRange(first, last, WIDEN_DAYS);
    const userId = String(check.userId);
    const records = await this.people.entriesOfPeople(
      operator,
      org.tenantId,
      [check.userId],
      wide.from,
      wide.to,
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
      .map((record) => workEntryOf(record, []));
    const existing = records.find((record) => String(record._id) === entryId);
    const beforeEntries =
      existing === undefined
        ? others
        : [
            ...others,
            workEntryOf(existing, windowsOf(check.before?.demandIds ?? [])),
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
      month: string;
      candidateIds: ReadonlySet<string>;
      allEntries: readonly EntryRecord[];
      busy: readonly BusyLike[];
      names: ReadonlyMap<string, string>;
    },
  ): Promise<ScheduleCheckItemModel[]> {
    const conflicts = input.allEntries.filter(
      (entry) =>
        entry.date.startsWith(`${input.month}-`) &&
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
        ...emptyItem(),
        key: DAY_OFF_ENTRY_CONFLICT_KEY,
        level: "reminder",
        message: `${entry.date} 畫休日有排班`,
        userId,
        userName: input.names.get(userId) ?? null,
        date: entry.date,
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

function workEntryOf(
  entry: EntryRecord,
  demands: WorkEntryLike["demands"],
): WorkEntryLike {
  return {
    id: String(entry._id),
    userId: String(entry.userId),
    orgId: String(entry.orgId),
    date: entry.date,
    startAt: entry.startAt,
    endAt: entry.endAt,
    breakMinutes: entry.breakMinutes,
    demands,
  };
}

/** 畫休(每天一列)→ 畫休規則吃的一段一筆(整天一筆、時段不可排每段一筆)。 */
function dayOffLikesOf(
  unavailability: readonly ScheduleUnavailability[],
): DayOffLike[] {
  return unavailability.flatMap((day) => [
    ...(day.fullDay
      ? [{ userId: day.userId, date: day.date, kind: "full-day" }]
      : []),
    ...day.slots.map(() => ({
      userId: day.userId,
      date: day.date,
      kind: "time-range",
    })),
  ]);
}

/** 畫休 → 不能排的時點區間(租戶時區:整天 = 當天 00:00 到隔天 00:00)。 */
export function busyOfUnavailability(
  unavailability: readonly ScheduleUnavailability[],
  timezone: string,
): BusyLike[] {
  return unavailability.flatMap((day) => {
    const date = parseLocalDate(day.date);
    if (date === null) {
      return [];
    }
    const at = (time: string) => {
      const minutes = minutesOfHhMm(time) ?? 0;
      return instantOfLocalTime(
        date,
        Math.floor(minutes / 60),
        minutes % 60,
        timezone,
      );
    };
    const dayStart = at("00:00");
    return [
      ...(day.fullDay
        ? [
            {
              userId: day.userId,
              kind: "full-day" as const,
              startAt: new Date(dayStart),
              endAt: new Date(addLocalCalendar(dayStart, 1, "days", timezone)),
            },
          ]
        : []),
      ...day.slots.map((slot) => ({
        userId: day.userId,
        kind: "time-range" as const,
        startAt: new Date(at(slot.startTime)),
        endAt: new Date(at(slot.endTime)),
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

function emptyItem(): CheckItem {
  return {
    key: "",
    level: "reminder",
    message: "",
    userId: null,
    userName: null,
    date: "",
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
  return {
    ...emptyItem(),
    key: violation.key,
    level,
    message: violation.message,
    userId,
    userName: userId === null ? null : (names.get(userId) ?? null),
    date: date.startsWith(`${month}-`) ? date : `${month}-01`,
    entryIds: [
      ...new Set(
        violation.targets.flatMap((target) =>
          target.entryId === undefined ? [] : [target.entryId],
        ),
      ),
    ],
    actual: violation.detail?.actual ?? null,
    limit: violation.detail?.limit ?? null,
    from: violation.detail?.from ?? null,
    to: violation.detail?.to ?? null,
    startAt: violation.detail?.startAt ?? null,
    endAt: violation.detail?.endAt ?? null,
    understaffed: violation.detail?.understaffed ?? null,
  };
}
