import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { isIsoDate, isIsoMonth } from "@repo/domain/project/schedule-settings";

import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import {
  ScheduleDemandsRepository,
  ScheduleEntriesRepository,
  SchedulePeriodsRepository,
  ScheduleTaskAssignmentsRepository,
} from "../../database/schedule/roster.repositories";
import { ScheduleDemandTemplatesRepository } from "../../database/schedule/schedule.repositories";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import { ScheduleDayOffsService } from "../day-offs/schedule-day-offs.service";
import { blockedEntryIdsOf } from "../integration/entry-deletion-guards";
import { positionAnnotationsOf } from "../integration/position-annotations";
import type { EffectiveRuleSetting } from "../rules/rule-registry";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
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
} from "./models/schedule-roster.model";
import { demandModelOf, entryModelOf } from "./roster-models";
import { RosterPeopleReader } from "./roster-people";
import { rosterStatsOf } from "./roster-stats";

/** 排班表要的權限(`@RequirePermission` 守端點;service 裡算 `canEdit`)。 */
export const ROSTER_PERMISSIONS = {
  view: "schedule.manage.view",
  edit: "schedule.manage.edit",
} as const;

/** `YYYY-MM` 的第一天與最後一天(`YYYY-MM-DD`)。 */
export function monthRange(month: string): { from: string; to: string } {
  const [year = 0, monthNumber = 0] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay)}` };
}

/** 週檢視跨月多讀的範圍最多超出這個月幾天(一週 7 天,跨月最多多 6 天)。 */
const RANGE_MARGIN_DAYS = 6;

const shiftIsoDate = (date: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
};

/**
 * 讀取範圍 = 這個月 ∪ `from`–`to`(週檢視跨月)。兩個都沒給 = 只讀這個月;
 * 只給一個、日期不合法、`from` 晚於 `to`、或超出這個月前後 6 天 → VALIDATION_FAILED。
 */
export function rosterReadRange(
  month: string,
  from: string | null | undefined,
  to: string | null | undefined,
): { from: string; to: string } {
  const own = monthRange(month);
  const hasFrom = from !== null && from !== undefined;
  const hasTo = to !== null && to !== undefined;
  if (!hasFrom && !hasTo) {
    return own;
  }
  if (
    !hasFrom ||
    !hasTo ||
    !isIsoDate(from) ||
    !isIsoDate(to) ||
    from > to ||
    from < shiftIsoDate(own.from, -RANGE_MARGIN_DAYS) ||
    to > shiftIsoDate(own.to, RANGE_MARGIN_DAYS)
  ) {
    throw validationError(`invalid range: ${String(from)}–${String(to)}`, [
      "from",
      "to",
    ]);
  }
  return {
    from: from < own.from ? from : own.from,
    to: to > own.to ? to : own.to,
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
  ) {}

  async roster(
    operator: OperatorContext,
    orgId: string | null | undefined,
    month: string,
    range: { from?: string | null; to?: string | null } = {},
  ): Promise<ScheduleRosterPayload> {
    if (!isIsoMonth(month)) {
      throw validationError(`invalid month: ${String(month)}`, ["month"]);
    }
    const { from, to } = rosterReadRange(month, range.from, range.to);
    const own = monthRange(month);
    const inMonth = (date: string) => date >= own.from && date <= own.to;
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
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
        { orgId: org.id, date: { $gte: from, $lte: to } },
        { sort: { startAt: 1, createdAt: 1 } },
      ),
      this.entries.findMany(
        operator,
        { orgId: org.id, date: { $gte: from, $lte: to } },
        { sort: { startAt: 1 } },
      ),
      this.templates.findMany(
        operator,
        { orgId: { $in: org.chain } },
        { sort: { startTime: 1, createdAt: 1 } },
      ),
      this.dayOffs.listUnavailable(operator, org.id, from, to),
      this.calendar.effectiveDays(operator, org.id, from, to),
      this.rules.effectiveSettingsForOrg(operator, org.id),
      this.periods.findOne(operator, { orgId: org.id, month }),
    ]);

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
      from,
      to,
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
      return {
        userId,
        name: candidate?.name ?? names.get(userId) ?? "",
        employmentType: candidate?.employmentType ?? null,
        canLead: candidate?.canLead ?? false,
        isPrimary: candidate?.isPrimary ?? false,
        isCandidate: candidate !== undefined,
        stats: rosterStatsOf({
          userId,
          entries: mine.map((entry) => ({
            date: entry.date,
            startAt: entry.startAt,
            endAt: entry.endAt,
            breakMinutes: entry.breakMinutes,
            isLead: leadEntryIds.has(String(entry._id)),
          })),
          allWorkDates: allEntries
            .filter(
              (entry) => String(entry.userId) === userId && inMonth(entry.date),
            )
            .map((entry) => entry.date),
          dayOffs: days.flatMap((day) => [
            ...(day.fullDay
              ? [{ userId, date: day.date, kind: "full-day" }]
              : []),
            ...day.slots.map(() => ({
              userId,
              date: day.date,
              kind: "time-range",
            })),
          ]),
          slots: days.flatMap((day) =>
            day.slots.map((slot) => ({ date: day.date, ...slot })),
          ),
        }),
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
    };
  }
}
