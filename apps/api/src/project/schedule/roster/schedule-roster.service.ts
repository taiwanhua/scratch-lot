import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { type InstantRange, parseLocalMonth } from "@repo/domain/form";

import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import {
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import { ScheduleDemandTemplatesRepository } from "../../database/schedule/schedule.repositories";
import { UnmatchedPunchesReader } from "../attendance/unmatched-punches";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import { ScheduleDayOffsService } from "../day-offs/schedule-day-offs.service";
import { blockedEntryIdsOf } from "../integration/entry-deletion-guards";
import { positionAnnotationsOf } from "../integration/position-annotations";
import type { EffectiveRuleSetting } from "../rules/rule-registry";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import {
  dateKeyOf,
  instantOfKey,
  instantRangeFilter,
  monthKeyRange,
  normalizedDayRange,
  shiftDateKey,
} from "../shared/schedule-dates";
import { validationError } from "../shared/schedule-error";
import { loadOrgNames, resolveScheduleOrg } from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import { compareScheduleNames } from "../shared/schedule-sort";
import { ScheduleStaffService } from "../staff/schedule-staff.service";
import type {
  ScheduleRosterPayload,
  ScheduleRosterPersonModel,
  ScheduleRosterSettingsModel,
  ScheduleRosterStatsModel,
} from "./models/schedule-roster.model";
import { demandModelOf, entryModelOf } from "./roster-models";
import { RosterPeopleReader } from "./roster-people";
import { type RosterStats, rosterStatsOf } from "./roster-stats";

/** 排班表要的權限(`@RequirePermission` 守端點;service 裡算 `canEdit`)。 */
export const ROSTER_PERMISSIONS = {
  view: "schedule.manage.view",
  edit: "schedule.manage.edit",
} as const;

/** 週檢視跨月多讀的範圍最多超出這個月幾天(一週 7 天,跨月最多多 6 天)。 */
const RANGE_MARGIN_DAYS = 6;

/**
 * 讀取範圍 = 這個月 ∪ `[from, to)`(週檢視跨月;時點以租戶時區正規化成 00:00)。兩個都沒給 = 只讀這個月;
 * 只給一個、不是時點、`from` 不早於 `to`、或超出這個月前後 6 天 → VALIDATION_FAILED(欄位 `from`、`to`)。
 */
export function rosterReadRange(
  own: InstantRange,
  from: Date | null | undefined,
  to: Date | null | undefined,
  timezone: string,
): InstantRange {
  const hasFrom = from !== null && from !== undefined;
  const hasTo = to !== null && to !== undefined;
  if (!hasFrom && !hasTo) {
    return own;
  }
  const extra = normalizedDayRange(from, to, timezone);
  const lowest = instantOfKey(
    shiftDateKey(dateKeyOf(own.from, timezone), -RANGE_MARGIN_DAYS),
    timezone,
  ).getTime();
  const highest = instantOfKey(
    shiftDateKey(dateKeyOf(own.to, timezone), RANGE_MARGIN_DAYS),
    timezone,
  ).getTime();
  if (extra.from < lowest || extra.to > highest) {
    throw validationError(
      `range out of the month margin: ${new Date(extra.from).toISOString()}–${new Date(extra.to).toISOString()}`,
      ["from", "to"],
    );
  }
  return {
    from: Math.min(extra.from, own.from),
    to: Math.max(extra.to, own.to),
  };
}

/** 統計 → 畫面:只有時段不可排的日子換回那天 00:00 的時點。 */
function statsModelOf(
  stats: RosterStats,
  timezone: string,
): ScheduleRosterStatsModel {
  return {
    ...stats,
    timeRangeDays: stats.timeRangeDays.map((day) => ({
      date: instantOfKey(day.date, timezone),
      slots: day.slots,
    })),
  };
}

function amountOf(setting: EffectiveRuleSetting | undefined): number | null {
  if (setting === undefined) {
    return null;
  }
  const amount = Number(setting.value.amount);
  return Number.isFinite(amount) ? amount : null;
}

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** 規則 `entryMatchToleranceMinutes` 讀不到時的預設(規格 14.2:60 分鐘)。 */
const DEFAULT_TOLERANCE_MINUTES = 60;

function settingsModelOf(
  settings: ReadonlyMap<string, EffectiveRuleSetting>,
): ScheduleRosterSettingsModel {
  const tiers = settings.get("defaultBreaks")?.value.tiers;
  const tasks = settings.get("defaultTasks")?.value ?? {};
  return {
    breakTiers: Array.isArray(tiers)
      ? tiers.flatMap((tier: unknown) => {
          const { minMinutes, breakMinutes } = tier as Record<string, unknown>;
          return typeof minMinutes === "number" &&
            typeof breakMinutes === "number"
            ? [{ minMinutes, breakMinutes }]
            : [];
        })
      : [],
    defaultLeaderTaskKey: textOf(tasks.defaultLeaderTaskKey),
    defaultHelperTaskKey: textOf(tasks.defaultHelperTaskKey),
    maxMonthlyDayOffs: amountOf(settings.get("maxMonthlyDayOffs")),
    minMonthlyDayOffs: amountOf(settings.get("minMonthlyDayOffs")),
    entryMatchToleranceMinutes:
      amountOf(settings.get("entryMatchToleranceMinutes")) ??
      DEFAULT_TOLERANCE_MINUTES,
  };
}

/**
 * 排班作業 → 排班表的讀取(規格 14.5「排班表」;正本 `docs/modules/project/schedule.md`「排班表」)。
 *
 * 一次回一家店一個月畫面要的全部:人(候選人 + 這個月有排班的人)與統計、人力需求(含誰填)、排班、
 * 別家店的班、畫休(`listUnavailable`)、行事曆、看得到的範本、規則的生效值。
 * 這家店要在操作者的可見範圍內(`resolveScheduleOrg`,看不到 → `NOT_FOUND`),之後才呼叫
 * 「空清單分不出看不到」的 `listUnavailable` / `listScheduleCandidates`。
 */
@Injectable()
export class ScheduleRosterService {
  constructor(
    private readonly demands: ScheduleDemandsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly assignments: ScheduleTaskAssignmentsRepository,
    private readonly periods: SchedulePeriodsRepository,
    private readonly templates: ScheduleDemandTemplatesRepository,
    private readonly orgs: OrgsRepository,
    private readonly permissions: SchedulePermissions,
    private readonly staff: ScheduleStaffService,
    private readonly dayOffs: ScheduleDayOffsService,
    private readonly calendar: ScheduleCalendarService,
    private readonly rules: ScheduleRulesService,
    private readonly people: RosterPeopleReader,
    private readonly unmatched: UnmatchedPunchesReader,
  ) {}

  async roster(
    operator: OperatorContext,
    orgId: string | null | undefined,
    month: string,
    range: { from?: Date | null; to?: Date | null } = {},
  ): Promise<ScheduleRosterPayload> {
    if (parseLocalMonth(month) === null) {
      throw validationError(`invalid month: ${month}`, ["month"]);
    }
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    const own = monthKeyRange(month, timezone);
    const read = rosterReadRange(own, range.from, range.to, timezone);
    const inMonth = (date: Date) =>
      date.getTime() >= own.from && date.getTime() < own.to;
    const holds = await this.permissions.holderOf(operator);

    const [
      candidates,
      demands,
      entries,
      templates,
      unavailability,
      calendarDays,
      settings,
      period,
    ] = await Promise.all([
      this.staff.listScheduleCandidates(operator, org.id),
      this.demands.findMany(
        operator,
        { orgId: org.id, date: instantRangeFilter(read) },
        { sort: { startAt: 1, createdAt: 1 } },
      ),
      this.entries.findMany(
        operator,
        { orgId: org.id, date: instantRangeFilter(read) },
        { sort: { startAt: 1 } },
      ),
      this.templates.findMany(
        operator,
        { orgId: { $in: org.chain } },
        { sort: { startTime: 1, createdAt: 1 } },
      ),
      this.dayOffs.listUnavailable(operator, org.id, read),
      this.calendar.effectiveDays(operator, org.id, read),
      this.rules.effectiveSettingsForOrg(operator, org.id),
      this.periods.findOne(operator, { orgId: org.id, month }),
    ]);
    const unmatchedPunches = await this.unmatched.of(
      operator,
      org.id,
      timezone,
      read,
    );

    const assignments =
      entries.length === 0
        ? []
        : await this.assignments.findMany(operator, {
            orgId: org.id,
            entryId: { $in: entries.map((entry) => entry._id) },
          });
    const demandById = new Map(
      demands.map((demand) => [String(demand._id), demand]),
    );
    const entryUser = new Map(
      entries.map((entry) => [String(entry._id), String(entry.userId)]),
    );

    // 人:候選人 + 這個月在這家店有排班、但已不是候選人的人
    const candidateIds = new Set(candidates.map((item) => item.userId));
    const extraIds = [
      ...new Set(
        entries
          .map((entry) => String(entry.userId))
          .filter((id) => !candidateIds.has(id)),
      ),
    ];
    const names = await this.people.namesOf([
      ...extraIds,
      ...entries.map((entry) => entry.userId),
      ...(period?.publishedBy ? [period.publishedBy] : []),
    ]);
    const peopleIds = [...candidateIds, ...extraIds].map(
      (id) => new Types.ObjectId(id),
    );
    const allEntries = await this.people.entriesOfPeople(
      operator,
      org.tenantId,
      peopleIds,
      read,
    );
    const otherEntries = allEntries.filter(
      (entry) => String(entry.orgId) !== String(org.id),
    );
    const otherOrgNames = await loadOrgNames(
      operator,
      this.orgs,
      otherEntries
        .map((entry) => entry.orgId)
        .filter((id) => isOrgVisible(operator, id)),
    );

    const leadEntryIds = new Set(
      assignments
        .filter((item) => {
          const demand = demandById.get(String(item.demandId));
          return (
            demand?.tasks.find((task) => task.taskId === item.taskId)?.role ===
            "leader"
          );
        })
        .map((item) => String(item.entryId)),
    );

    // 統計只算這個月(週檢視跨月多讀的日子不算)
    const personOf = (
      userId: string,
      candidate?: (typeof candidates)[number],
    ): ScheduleRosterPersonModel => {
      const mine = entries.filter(
        (entry) => String(entry.userId) === userId && inMonth(entry.date),
      );
      const days = unavailability.filter(
        (item) => item.userId === userId && inMonth(item.date),
      );
      // 統計的規則運算用租戶時區的日期鍵(輸出再換回那天 00:00 的時點)
      const keyOf = (date: Date) => dateKeyOf(date, timezone);
      return {
        userId,
        name: candidate?.name ?? names.get(userId) ?? "",
        employmentType: candidate?.employmentType ?? null,
        canLead: candidate?.canLead ?? false,
        isPrimary: candidate?.isPrimary ?? false,
        isCandidate: candidate !== undefined,
        stats: statsModelOf(
          rosterStatsOf({
            userId,
            entries: mine.map((entry) => ({
              date: keyOf(entry.date),
              startAt: entry.startAt,
              endAt: entry.endAt,
              breakMinutes: entry.breakMinutes,
              isLead: leadEntryIds.has(String(entry._id)),
            })),
            allWorkDates: allEntries
              .filter(
                (entry) =>
                  String(entry.userId) === userId && inMonth(entry.date),
              )
              .map((entry) => keyOf(entry.date)),
            dayOffs: days.flatMap((day) => [
              ...(day.fullDay
                ? [{ userId, date: keyOf(day.date), kind: "full-day" }]
                : []),
              ...day.slots.map(() => ({
                userId,
                date: keyOf(day.date),
                kind: "time-range",
              })),
            ]),
            slots: days.flatMap((day) =>
              day.slots.map((slot) => ({ date: keyOf(day.date), ...slot })),
            ),
          }),
          timezone,
        ),
      };
    };

    const people = [
      ...candidates.map((candidate) => personOf(candidate.userId, candidate)),
      ...extraIds
        .map((id) => personOf(id))
        .toSorted((left, right) => compareScheduleNames(left.name, right.name)),
    ];

    const blocked = await blockedEntryIdsOf(
      String(org.tenantId),
      entries.map((entry) => String(entry._id)),
    );
    const positionNotes = await positionAnnotationsOf(
      String(org.tenantId),
      String(org.id),
    );
    const visibleTemplateIds = new Set(
      templates.map((template) => String(template._id)),
    );

    return {
      orgId: String(org.id),
      orgName: org.name,
      month,
      period: {
        status: period?.status ?? "unpublished",
        publishedAt: period?.publishedAt ?? null,
        publishedByName: period?.publishedBy
          ? (names.get(String(period.publishedBy)) ?? null)
          : null,
      },
      canEdit: holds(ROSTER_PERMISSIONS.edit),
      canSaveTemplate: holds(SCHEDULE_PERMISSIONS.editTemplates),
      canUsePunchTime: holds(SCHEDULE_PERMISSIONS.usePunchTime),
      settings: settingsModelOf(settings),
      people,
      demands: demands.map((demand) =>
        demandModelOf(demand, {
          assignments,
          entryUser,
          names: new Map([
            ...names,
            ...candidates.map(
              (candidate) => [candidate.userId, candidate.name] as const,
            ),
          ]),
          positionNotes,
          visibleTemplateIds,
        }),
      ),
      entries: entries.map((entry) =>
        entryModelOf(entry, { assignments, demands: demandById, blocked }),
      ),
      otherStoreEntries: otherEntries.map((entry) => ({
        userId: String(entry.userId),
        date: entry.date,
        startAt: entry.startAt,
        endAt: entry.endAt,
        orgName: otherOrgNames.get(String(entry.orgId)) ?? null,
      })),
      unavailability,
      calendarDays: calendarDays.map((day) => ({
        date: day.date,
        type: day.type,
        name: day.name,
        paletteKey: day.paletteKey,
      })),
      templates: templates.map((template) => ({
        id: String(template._id),
        name: template.name,
        shortName: template.shortName,
        startTime: template.startTime,
        endTime: template.endTime,
        positionKey: template.positionKey,
        paletteKey: template.paletteKey,
        tasks: template.tasks.map((task) => ({
          taskId: task.taskId,
          role: task.role,
          taskKey: task.taskKey,
        })),
      })),
      unmatchedPunches,
    };
  }
}
