import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Types } from "mongoose";

import { localDateOf, localDateText } from "@repo/domain/form";
import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_DAY_OFF_KINDS,
  type ScheduleDayOffKind,
  isHhMm,
  isIsoDate,
  isIsoMonth,
  minutesOfHhMm,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  type ScheduleDayOffDocument,
  ScheduleDayOffLocksRepository,
  ScheduleDayOffsRepository,
  ScheduleRelationshipsRepository,
  ScheduleStaffRepository,
} from "../../database/schedule/schedule.repositories";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import type {
  EffectiveRuleSetting,
  ScheduleRuleViolation,
} from "../rules/rule-registry";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  dayOffRuleError,
  forbiddenError,
  isDuplicateKeyError,
  notFoundError,
  savingUnique,
  validationError,
} from "../shared/schedule-error";
import {
  parseObjectId,
  resolveScheduleOrg,
  scheduleReadContext,
  scheduleSystemReader,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import type { ScheduleCandidate } from "../staff/schedule-candidates";
import { ScheduleStaffService } from "../staff/schedule-staff.service";
import {
  DAY_OFF_STORE_RULE_KEY,
  type DayOffLike,
  dayOffDates,
  dayOffStaffCounts,
  evaluateDayOffRules,
  registerDayOffRuleEvaluators,
} from "./day-off-rules";
import {
  type DayOffWindow,
  type DayOffWindowValue,
  dayOffTargetMonth,
  dayOffWindowDaysLeft,
  dayOffWindowFor,
  dayOffWindowState,
  dayOffWindowValueOf,
  shiftMonth,
} from "./day-off-window";
import type {
  AddMyScheduleDayOffsInput,
  AddScheduleDayOffsOnBehalfInput,
  DeleteScheduleDayOffOnBehalfInput,
  ScheduleDayOffSlotInput,
} from "./dto/schedule-day-off.input";
import type {
  MyScheduleDayOffsPayload,
  SaveScheduleDayOffsPayload,
  ScheduleDayOffDayModel,
  ScheduleDayOffLimitsModel,
  ScheduleDayOffModel,
  ScheduleDayOffOverviewPayload,
  ScheduleDayOffViolationModel,
  ScheduleDayOffWindowModel,
} from "./models/schedule-day-off.model";

type DayOffRecord = Persisted<ScheduleDayOffDocument>;

const ORG_STAFF = "org_schedule_staff";
const AUDIT_TARGET_TYPE = "schedule_day_off";
const DAY_OFF_WINDOW_KEY = "dayOffWindow";

/** 某個人某天不能排的時間(`listUnavailable`;給排班表、自動排班)。 */
export interface ScheduleUnavailability {
  userId: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** 有整天畫休 */
  fullDay: boolean;
  /** 時段不可排(依開始時間) */
  slots: { startTime: string; endTime: string }[];
}

/** 一次要寫的畫休(登記 / 代改共用)。 */
interface DayOffWrite {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  date: string;
  kind: ScheduleDayOffKind;
  slots: { startTime: string; endTime: string }[];
  note: string | null;
  by: Types.ObjectId | null;
  reason: string | null;
  reasonNote: string | null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function isKind(value: string): value is ScheduleDayOffKind {
  return (SCHEDULE_DAY_OFF_KINDS as readonly string[]).includes(value);
}

const overlaps = (
  left: { startTime: string; endTime: string },
  right: { startTime: string; endTime: string },
) => left.startTime < right.endTime && right.startTime < left.endTime;

function windowValueOf(
  settings: ReadonlyMap<string, EffectiveRuleSetting>,
): DayOffWindowValue {
  return dayOffWindowValueOf(settings.get(DAY_OFF_WINDOW_KEY));
}

function amountOrNull(
  settings: ReadonlyMap<string, EffectiveRuleSetting>,
  key: string,
): number | null {
  const setting = settings.get(key);
  return setting?.enabled === true ? Number(setting.value.amount ?? 0) : null;
}

function limitsOf(
  settings: ReadonlyMap<string, EffectiveRuleSetting>,
): ScheduleDayOffLimitsModel {
  return {
    maxMonthly: amountOrNull(settings, "maxMonthlyDayOffs"),
    minMonthly: amountOrNull(settings, "minMonthlyDayOffs"),
    maxDailyStaff: amountOrNull(settings, DAY_OFF_STORE_RULE_KEY),
  };
}

function windowModelOf(
  window: DayOffWindow,
  today: string,
): ScheduleDayOffWindowModel {
  return {
    ...window,
    state: dayOffWindowState(window, today),
    daysLeft: dayOffWindowDaysLeft(window, today),
  };
}

function violationModelOf(
  violation: ScheduleRuleViolation,
): ScheduleDayOffViolationModel {
  const dates = [
    ...new Set(
      violation.targets.flatMap((target) =>
        target.date === undefined ? [] : [target.date],
      ),
    ),
  ];
  return {
    key: violation.key,
    level: violation.level,
    message: violation.message,
    dates,
    actual: violation.detail?.actual ?? null,
    limit: violation.detail?.limit ?? null,
    from: violation.detail?.from ?? null,
    to: violation.detail?.to ?? null,
  };
}

/**
 * 存檔時不擋的規則:「每月最少畫休」是開放期間結束時要達到的量 —— 登記途中本來就不足,
 * 擋刪除會讓人改不掉登記錯的那天;照樣列在違規清單(等級照設定)。
 */
const NOT_BLOCKING_ON_SAVE: ReadonlySet<string> = new Set([
  "minMonthlyDayOffs",
]);

/** 限制等級的違反「有多嚴重」(超出的量);存檔前後比較,變多的才擋。 */
function severityByKey(
  violations: readonly ScheduleRuleViolation[],
): Map<string, number> {
  const severity = new Map<string, number>();
  for (const violation of violations) {
    if (
      violation.level !== "limit" ||
      NOT_BLOCKING_ON_SAVE.has(violation.key)
    ) {
      continue;
    }
    const amount = Math.abs(
      (violation.detail?.actual ?? 0) - (violation.detail?.limit ?? 0),
    );
    severity.set(violation.key, (severity.get(violation.key) ?? 0) + amount);
  }
  return severity;
}

const toLike = (record: {
  userId: Types.ObjectId | string;
  date: string;
  kind: string;
}): DayOffLike => ({
  userId: String(record.userId),
  date: record.date,
  kind: record.kind,
});

const byTime = (
  left: { date: string; startTime: string | null; name?: string },
  right: { date: string; startTime: string | null; name?: string },
) =>
  left.date.localeCompare(right.date) ||
  (left.startTime ?? "").localeCompare(right.startTime ?? "") ||
  (left.name ?? "").localeCompare(right.name ?? "");

/**
 * 畫休(規格 14.1 `schedule_day_offs`、14.2 畫休規則、14.5 畫休總覽、14.6 我的畫休;
 * 正本 `docs/modules/project/schedule.md`「畫休」)。
 *
 * - **屬於人**:一筆歸屬租戶頂層;那段時間所有分店都不能排
 * - **人的規則用主要分店的設定**;同日最多畫休人數只計以那家店為主要分店的人
 * - **本人**:只能在主要分店的開放期間內登記 / 刪除下個月;不需核准,違反限制不存
 * - **代改**(`schedule.manage.edit-day-offs`):不受開放期間限制;截止後原因必填,選「其他」要說明;記代改人
 * - 違反限制(存檔後限制的違反比存檔前多)→ `VALIDATION_FAILED`(`fields: ["date"]`、`violations`);提醒照存
 */
@Injectable()
export class ScheduleDayOffsService implements OnModuleInit {
  constructor(
    private readonly dayOffs: ScheduleDayOffsRepository,
    private readonly locks: ScheduleDayOffLocksRepository,
    private readonly staff: ScheduleStaffRepository,
    private readonly relationships: ScheduleRelationshipsRepository,
    private readonly users: UsersRepository,
    private readonly orgs: OrgsRepository,
    private readonly rules: ScheduleRulesService,
    private readonly staffService: ScheduleStaffService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly transactions: TransactionService,
    private readonly clock: ScheduleClock,
  ) {}

  onModuleInit(): void {
    registerDayOffRuleEvaluators();
  }

  // ---- 我的畫休 ----

  async mine(
    operator: OperatorContext,
    month: string | null | undefined,
  ): Promise<MyScheduleDayOffsPayload> {
    const { tenantId, userId } = await this.self(operator);
    const today = await this.today(operator, tenantId);
    const target = month ?? dayOffTargetMonth(today);
    if (!isIsoMonth(target)) {
      throw validationError("month must be YYYY-MM", ["month"]);
    }
    const holds = await this.permissions.holderOf(operator);
    const canOverride =
      holds(SCHEDULE_PERMISSIONS.viewDayOffs) &&
      holds(SCHEDULE_PERMISSIONS.editDayOffs);
    const primaryOrgId = await this.primaryOrgOf(tenantId, userId);
    if (primaryOrgId === null) {
      return {
        month: target,
        primaryOrg: null,
        window: null,
        canEdit: false,
        canOverride,
        limits: { maxMonthly: null, minMonthly: null, maxDailyStaff: null },
        dayOffCount: 0,
        myDayOffs: [],
        days: [],
        violations: [],
      };
    }
    const settings = await this.rules.effectiveSettingsForOrg(
      operator,
      primaryOrgId,
    );
    const window = windowModelOf(
      dayOffWindowFor(target, windowValueOf(settings)),
      today,
    );
    const members = await this.primaryMembersOf(tenantId, primaryOrgId);
    const records = await this.recordsAround(
      tenantId,
      [...new Set([...members, String(userId)])],
      target,
    );
    const names = await this.namesOf(records);
    const me = String(userId);
    const monthRecords = records.filter((record) =>
      record.date.startsWith(`${target}-`),
    );
    const mine = monthRecords.filter((record) => String(record.userId) === me);
    const myDates = new Set(mine.map((record) => record.date));
    const violations = await this.evaluate({
      tenantId,
      orgId: primaryOrgId,
      settings,
      userId: me,
      month: target,
      records: records.map((record) => toLike(record)),
      members: new Set(members),
    });
    const primaryOrg = await this.orgs.findById(
      scheduleReadContext(operator),
      primaryOrgId,
    );
    const primaryName = primaryOrg?.name ?? "";
    return {
      month: target,
      primaryOrg: { id: String(primaryOrgId), name: primaryName },
      window,
      canEdit: window.state === "open",
      canOverride,
      limits: limitsOf(settings),
      dayOffCount: myDates.size,
      myDayOffs: mine
        .map((record) => this.modelOf(record, names, true))
        .toSorted(byTime),
      days: daysOf(
        monthRecords.filter((record) =>
          members.includes(String(record.userId)),
        ),
        names,
        new Set(members),
      ),
      violations: violations
        .filter(
          (violation) =>
            violation.key !== DAY_OFF_STORE_RULE_KEY ||
            violation.targets.some(
              (item) => item.date !== undefined && myDates.has(item.date),
            ),
        )
        .map((violation) => violationModelOf(violation)),
    };
  }

  async addMine(
    operator: OperatorContext,
    input: AddMyScheduleDayOffsInput,
  ): Promise<SaveScheduleDayOffsPayload> {
    const { tenantId, userId } = await this.self(operator);
    const write = validatedWrite(input, { tenantId, userId });
    const context = await this.personContext(operator, tenantId, userId);
    this.assertWindowOpen(context, write.date);
    return this.save(operator, context, {
      ...write,
      note: blankToNull(input.note),
      by: null,
      reason: null,
      reasonNote: null,
    });
  }

  async removeMine(operator: OperatorContext, id: string): Promise<string> {
    const { tenantId, userId } = await this.self(operator);
    const record = await this.mustRecord(tenantId, id, [String(userId)]);
    const context = await this.personContext(operator, tenantId, userId);
    this.assertWindowOpen(context, record.date);
    return this.remove(operator, context, record, null);
  }

  // ---- 畫休總覽、代改 ----

  async overview(
    operator: OperatorContext,
    orgId: string | null | undefined,
    month: string | null | undefined,
  ): Promise<ScheduleDayOffOverviewPayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const today = await this.today(operator, org.tenantId);
    const target = month ?? dayOffTargetMonth(today);
    if (!isIsoMonth(target)) {
      throw validationError("month must be YYYY-MM", ["month"]);
    }
    const settings = await this.rules.effectiveSettingsForOrg(operator, org.id);
    const candidates = await this.staffService.listScheduleCandidates(
      operator,
      org.id,
    );
    const primary = new Set(
      candidates
        .filter((candidate) => candidate.isPrimary)
        .map((candidate) => candidate.userId),
    );
    const records = await this.recordsBetween(
      org.tenantId,
      candidates.map((candidate) => candidate.userId),
      `${target}-01`,
      `${target}-31`,
    );
    const names = new Map(
      candidates.map((candidate) => [candidate.userId, candidate.name]),
    );
    await this.addByNames(records, names);
    const holds = await this.permissions.holderOf(operator);
    return {
      orgId: String(org.id),
      orgName: org.name,
      month: target,
      window: windowModelOf(
        dayOffWindowFor(target, windowValueOf(settings)),
        today,
      ),
      canEdit: holds(SCHEDULE_PERMISSIONS.editDayOffs),
      limits: limitsOf(settings),
      staff: candidates.map((candidate) => ({
        userId: candidate.userId,
        name: candidate.name,
        isPrimary: candidate.isPrimary,
        dayOffCount: dayOffDates(
          records.map((record) => toLike(record)),
          candidate.userId,
        ).length,
      })),
      days: daysOf(records, names, primary),
    };
  }

  async addOnBehalf(
    operator: OperatorContext,
    input: AddScheduleDayOffsOnBehalfInput,
  ): Promise<SaveScheduleDayOffsPayload> {
    const { tenantId, userId } = await this.mustCandidate(
      operator,
      input.orgId,
      input.userId,
    );
    const write = validatedWrite(input, { tenantId, userId });
    const context = await this.personContext(operator, tenantId, userId);
    const reason = await this.validatedReason(operator, context, write.date, {
      reason: input.reason,
      reasonNote: input.reasonNote,
    });
    return this.save(operator, context, {
      ...write,
      note: null,
      by: operator.actorId,
      ...reason,
    });
  }

  async removeOnBehalf(
    operator: OperatorContext,
    input: DeleteScheduleDayOffOnBehalfInput,
  ): Promise<string> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const candidates = await this.staffService.listScheduleCandidates(
      operator,
      org.id,
    );
    const record = await this.mustRecord(
      org.tenantId,
      input.id,
      candidates.map((candidate) => candidate.userId),
    );
    const context = await this.personContext(
      operator,
      org.tenantId,
      record.userId,
    );
    const reason = await this.validatedReason(operator, context, record.date, {
      reason: input.reason,
      reasonNote: input.reasonNote,
    });
    return this.remove(operator, context, record, {
      by: operator.actorId,
      ...reason,
    });
  }

  // ---- 給其他功能 ----

  /**
   * 某家店的排班人員在一段日期(`YYYY-MM-DD`,含頭尾)每天的整天畫休 / 時段不可排
   * (給排班表、人力不足原因、自動排班;畫休屬於人,不分是在哪家店登記的)。
   * 只列有畫休的那幾天;不看操作者的可見範圍(呼叫端已確認看得到這家店)。
   */
  async listUnavailable(
    orgId: Types.ObjectId,
    from: string,
    to: string,
  ): Promise<ScheduleUnavailability[]> {
    const reader = scheduleSystemReader();
    const org = await this.orgs.findById(reader, orgId);
    if (!org) {
      return [];
    }
    const [, tenantTop] = org.ancestors;
    const tenantId = tenantTop ?? org._id;
    const candidates = await this.staffService.listScheduleCandidates(
      reader,
      orgId,
    );
    const records = await this.recordsBetween(
      tenantId,
      candidates.map((candidate) => candidate.userId),
      from,
      to,
    );
    const byKey = new Map<string, ScheduleUnavailability>();
    for (const record of records.toSorted(byTime)) {
      const key = `${String(record.userId)}|${record.date}`;
      const item = byKey.get(key) ?? {
        userId: String(record.userId),
        date: record.date,
        fullDay: false,
        slots: [],
      };
      if (record.kind === "full-day") {
        item.fullDay = true;
      } else if (record.startTime !== null && record.endTime !== null) {
        item.slots.push({
          startTime: record.startTime,
          endTime: record.endTime,
        });
      }
      byKey.set(key, item);
    }
    return [...byKey.values()];
  }

  // ---- 內部 ----

  /** 登入者本人(在當前組織的租戶裡)。 */
  private async self(
    operator: OperatorContext,
  ): Promise<{ tenantId: Types.ObjectId; userId: Types.ObjectId }> {
    const org = await resolveScheduleOrg(operator, this.orgs, null);
    if (operator.actorId === null) {
      throw forbiddenError("no actor", "MISSING_PERMISSION");
    }
    return { tenantId: org.tenantId, userId: operator.actorId };
  }

  private async today(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
  ): Promise<string> {
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    return localDateText(localDateOf(this.clock.now().getTime(), timezone));
  }

  /** 這個人的主要分店(沒有排班檔案、或沒有可以排的分店 → null)。 */
  private async primaryOrgOf(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const reader = scheduleSystemReader();
    const profile = await this.staff.findOne(reader, { tenantId, userId });
    if (!profile) {
      return null;
    }
    const link = await this.relationships.findOne(reader, {
      type: ORG_STAFF,
      tenantId,
      secondId: profile._id,
      "meta.isPrimary": true,
    });
    return link?.firstId ?? null;
  }

  /** 以這家店為主要分店的人(userId)。 */
  private async primaryMembersOf(
    tenantId: Types.ObjectId,
    orgId: Types.ObjectId,
  ): Promise<string[]> {
    const reader = scheduleSystemReader();
    const links = await this.relationships.findMany(reader, {
      type: ORG_STAFF,
      tenantId,
      firstId: orgId,
      "meta.isPrimary": true,
    });
    if (links.length === 0) {
      return [];
    }
    const profiles = await this.staff.findMany(reader, {
      tenantId,
      _id: { $in: links.map((link) => link.secondId) },
    });
    return profiles.map((profile) => String(profile.userId));
  }

  /** 檢查一個人的畫休要用的:主要分店、它的生效設定、今天。 */
  private async personContext(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<PersonContext> {
    const primaryOrgId = await this.primaryOrgOf(tenantId, userId);
    if (primaryOrgId === null) {
      throw validationError(
        `user ${String(userId)} has no primary store for schedule`,
        ["userId"],
      );
    }
    const settings = await this.rules.effectiveSettingsForOrg(
      operator,
      primaryOrgId,
    );
    return {
      tenantId,
      userId,
      primaryOrgId,
      settings,
      today: await this.today(operator, tenantId),
    };
  }

  /** 本人:這一天所在的月份要正在開放中(主要分店的開放期間)。 */
  private assertWindowOpen(context: PersonContext, date: string): void {
    const window = dayOffWindowFor(
      date.slice(0, 7),
      windowValueOf(context.settings),
    );
    if (dayOffWindowState(window, context.today) !== "open") {
      throw forbiddenError(
        `day-off window for ${window.month} is ${window.startDate}–${window.endDate}`,
        "OUTSIDE_DAY_OFF_WINDOW",
      );
    }
  }

  /** 代改的原因:截止前可空;截止後(含開放期間已過的月份)必填,選「其他」說明必填。 */
  private async validatedReason(
    operator: OperatorContext,
    context: PersonContext,
    date: string,
    input: { reason?: string | null; reasonNote?: string | null },
  ): Promise<{ reason: string | null; reasonNote: string | null }> {
    const reason = blankToNull(input.reason);
    const reasonNote = blankToNull(input.reasonNote);
    const window = dayOffWindowFor(
      date.slice(0, 7),
      windowValueOf(context.settings),
    );
    const closed = dayOffWindowState(window, context.today) === "closed";
    if (closed && reason === null) {
      throw validationError("reason is required after the deadline", [
        "reason",
      ]);
    }
    if (reason !== null) {
      await this.fieldOptions.assertOptions(operator, [
        {
          categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.dayOffOverrideReason,
          value: reason,
          field: "reason",
        },
      ]);
      if (requiresReasonNote(reason) && reasonNote === null) {
        throw validationError("reasonNote is required for other", [
          "reasonNote",
        ]);
      }
    }
    return { reason, reasonNote: reason === null ? null : reasonNote };
  }

  /** 代改的對象:這家店(要看得到)的排班人員;否則 `NOT_FOUND`。 */
  private async mustCandidate(
    operator: OperatorContext,
    orgId: string | null | undefined,
    userId: string,
  ): Promise<{ tenantId: Types.ObjectId; userId: Types.ObjectId }> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const target = parseObjectId(userId, "userId");
    const candidates: ScheduleCandidate[] =
      await this.staffService.listScheduleCandidates(operator, org.id);
    if (!candidates.some((candidate) => candidate.userId === String(target))) {
      throw notFoundError(`schedule staff not found: ${userId}`);
    }
    return { tenantId: org.tenantId, userId: target };
  }

  /** 這個租戶裡、屬於這些人的一筆畫休;否則 `NOT_FOUND`。 */
  private async mustRecord(
    tenantId: Types.ObjectId,
    id: string,
    userIds: readonly string[],
  ): Promise<DayOffRecord> {
    const record = await this.dayOffs.findOne(scheduleSystemReader(), {
      _id: parseObjectId(id, "id"),
      tenantId,
    });
    if (!record || !userIds.includes(String(record.userId))) {
      throw notFoundError(`day off not found: ${id}`);
    }
    return record;
  }

  /**
   * 登記 / 代改:「讀那天的畫休 → 檢查重疊 → 跑規則 → 寫入」整段在同一個交易裡;交易一開始先碰守門文件
   * (主要分店 × 月份),同時進來的寫入互相衝突、由 `TransactionService` 重跑,不會被同時送出繞過限制。
   */
  private async save(
    operator: OperatorContext,
    context: PersonContext,
    write: DayOffWrite,
  ): Promise<SaveScheduleDayOffsPayload> {
    const added: DayOffLike[] =
      write.kind === "full-day"
        ? [{ userId: String(write.userId), date: write.date, kind: write.kind }]
        : write.slots.map(() => ({
            userId: String(write.userId),
            date: write.date,
            kind: write.kind,
          }));
    const rows =
      write.kind === "full-day"
        ? [{ startTime: null, endTime: null }]
        : write.slots;
    const withAdded = (entries: { like: DayOffLike }[]) => [
      ...entries.map((entry) => entry.like),
      ...added,
    ];
    await this.ensureLock(operator, context, write.date);
    const { created, after } = await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          await this.touchLock(operator, context, write.date);
          const existing = await this.recordsBetween(
            context.tenantId,
            [String(context.userId)],
            write.date,
            write.date,
          );
          assertNoConflict(existing, write);
          const violations = await this.assertRules(
            context,
            write.date,
            withAdded,
          );
          const items: DayOffRecord[] = [];
          for (const row of rows) {
            const record = await this.dayOffs.create(
              scheduleReadContext(operator),
              {
                orgId: context.tenantId,
                userId: write.userId,
                date: write.date,
                kind: write.kind,
                startTime: row.startTime,
                endTime: row.endTime,
                note: write.note,
                by: write.by,
                reason: write.reason,
                reasonNote: write.reasonNote,
              },
            );
            await this.audit.record(operator, {
              action: "schedule-day-off.create",
              targetType: AUDIT_TARGET_TYPE,
              targetId: record._id,
              after: auditOf(record),
            });
            items.push(record);
          }
          return { created: items, after: violations };
        }),
      `already has a full-day day off on ${write.date}`,
      ["kind"],
    );
    const names = await this.namesOf(created);
    return {
      items: created.map((record) => this.modelOf(record, names, true)),
      violations: after.map((violation) => violationModelOf(violation)),
    };
  }

  /** 刪除:同登記,規則檢查與寫入在同一個交易、交易一開始先碰守門文件。 */
  private async remove(
    operator: OperatorContext,
    context: PersonContext,
    record: DayOffRecord,
    override: {
      by: Types.ObjectId | null;
      reason: string | null;
      reasonNote: string | null;
    } | null,
  ): Promise<string> {
    const writer = scheduleReadContext(operator);
    await this.ensureLock(operator, context, record.date);
    await this.transactions.withTransaction(async () => {
      await this.touchLock(operator, context, record.date);
      const current = await this.dayOffs.findOne(scheduleSystemReader(), {
        _id: record._id,
        tenantId: context.tenantId,
      });
      if (!current) {
        throw notFoundError(`day off not found: ${String(record._id)}`);
      }
      await this.assertRules(context, record.date, (entries) =>
        entries
          .filter((entry) => entry.id !== String(record._id))
          .map((entry) => entry.like),
      );
      if (override !== null) {
        await this.dayOffs.updateById(writer, record._id, { $set: override });
      }
      await this.dayOffs.softDeleteById(writer, record._id);
      await this.audit.record(operator, {
        action: "schedule-day-off.delete",
        targetType: AUDIT_TARGET_TYPE,
        targetId: record._id,
        before: auditOf(record),
        after: override ?? undefined,
      });
    });
    return String(record._id);
  }

  /**
   * 守門文件(主要分店 × 月份)先建好(交易外;兩個請求同時建,唯一索引擋下的那一個略過),
   * 交易裡只做 `$inc`,同時的寫入才會在既有文件上衝突、交給交易重跑。
   */
  private async ensureLock(
    operator: OperatorContext,
    context: PersonContext,
    date: string,
  ): Promise<void> {
    const key = {
      orgId: context.tenantId,
      storeId: context.primaryOrgId,
      month: date.slice(0, 7),
    };
    const existing = await this.locks.findOne(scheduleSystemReader(), key);
    if (existing) {
      return;
    }
    try {
      await this.locks.create(scheduleReadContext(operator), {
        ...key,
        version: 0,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /** 交易一開始對守門文件 `$inc`:之後讀到的畫休就是這一刻之後的快照,同時寫入的另一方會衝突重跑。 */
  private async touchLock(
    operator: OperatorContext,
    context: PersonContext,
    date: string,
  ): Promise<void> {
    await this.locks.findOneAndUpdate(
      scheduleReadContext(operator),
      {
        orgId: context.tenantId,
        storeId: context.primaryOrgId,
        month: date.slice(0, 7),
      },
      { $inc: { version: 1 } },
    );
  }

  /**
   * 跑畫休規則,存檔後限制的違反比存檔前多(新的、或更嚴重)→ 擋下並回原因;回存檔後涉及這個人的違反。
   * 店的規則只看這次改的那一天。
   */
  private async assertRules(
    context: PersonContext,
    date: string,
    change: (entries: { id: string; like: DayOffLike }[]) => DayOffLike[],
  ): Promise<ScheduleRuleViolation[]> {
    const month = date.slice(0, 7);
    const members = await this.primaryMembersOf(
      context.tenantId,
      context.primaryOrgId,
    );
    const me = String(context.userId);
    const records = await this.recordsAround(
      context.tenantId,
      [...new Set([...members, me])],
      month,
    );
    const entries = records.map((record) => ({
      id: String(record._id),
      like: toLike(record),
    }));
    const before = entries.map((entry) => entry.like);
    const input = {
      tenantId: context.tenantId,
      orgId: context.primaryOrgId,
      settings: context.settings,
      userId: me,
      month,
      members: new Set(members),
    };
    const relevant = (violations: ScheduleRuleViolation[]) =>
      violations.filter(
        (violation) =>
          violation.key !== DAY_OFF_STORE_RULE_KEY ||
          violation.detail?.from === date,
      );
    const beforeViolations = relevant(
      await this.evaluate({ ...input, records: before }),
    );
    const afterViolations = relevant(
      await this.evaluate({ ...input, records: change(entries) }),
    );
    const beforeSeverity = severityByKey(beforeViolations);
    const worse = [...severityByKey(afterViolations)]
      .filter(([key, amount]) => amount > (beforeSeverity.get(key) ?? 0))
      .map(([key]) => key);
    if (worse.length > 0) {
      throw dayOffRuleError(
        afterViolations
          .filter(
            (violation) =>
              violation.level === "limit" && worse.includes(violation.key),
          )
          .map((violation) => violationModelOf(violation)),
      );
    }
    return afterViolations;
  }

  private evaluate(input: {
    tenantId: Types.ObjectId;
    orgId: Types.ObjectId;
    settings: ReadonlyMap<string, EffectiveRuleSetting>;
    userId: string;
    month: string;
    records: DayOffLike[];
    members: ReadonlySet<string>;
  }): Promise<ScheduleRuleViolation[]> {
    return evaluateDayOffRules({
      tenantId: String(input.tenantId),
      orgId: String(input.orgId),
      settings: input.settings,
      person: {
        userId: input.userId,
        month: input.month,
        dayOffs: input.records.filter(
          (record) => record.userId === input.userId,
        ),
      },
      store: {
        month: input.month,
        dayOffs: input.records.filter((record) =>
          input.members.has(record.userId),
        ),
      },
    });
  }

  /** 這些人在某個月前後各一個月的畫休(連續休假會跨月)。 */
  private recordsAround(
    tenantId: Types.ObjectId,
    userIds: readonly string[],
    month: string,
  ): Promise<DayOffRecord[]> {
    return this.recordsBetween(
      tenantId,
      userIds,
      `${shiftMonth(month, -1)}-01`,
      `${shiftMonth(month, 1)}-31`,
    );
  }

  private async recordsBetween(
    tenantId: Types.ObjectId,
    userIds: readonly string[],
    from: string,
    to: string,
  ): Promise<DayOffRecord[]> {
    if (userIds.length === 0) {
      return [];
    }
    return this.dayOffs.findMany(scheduleSystemReader(), {
      tenantId,
      userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      date: { $gte: from, $lte: to },
    });
  }

  /** 畫休的人與代改人的名稱。 */
  private async namesOf(
    records: readonly DayOffRecord[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    await this.addNames(
      records.flatMap((record) =>
        record.by === null ? [record.userId] : [record.userId, record.by],
      ),
      names,
    );
    return names;
  }

  private async addByNames(
    records: readonly DayOffRecord[],
    names: Map<string, string>,
  ): Promise<void> {
    await this.addNames(
      records.flatMap((record) => (record.by === null ? [] : [record.by])),
      names,
    );
  }

  private async addNames(
    ids: readonly Types.ObjectId[],
    names: Map<string, string>,
  ): Promise<void> {
    const missing = [...new Set(ids.map(String))].filter(
      (id) => !names.has(id),
    );
    if (missing.length === 0) {
      return;
    }
    const users = await this.users.findMany(scheduleSystemReader(), {
      _id: { $in: missing.map((id) => new Types.ObjectId(id)) },
    });
    for (const user of users) {
      names.set(String(user._id), user.name);
    }
  }

  private modelOf(
    record: DayOffRecord,
    names: ReadonlyMap<string, string>,
    isPrimary: boolean,
  ): ScheduleDayOffModel {
    return dayOffModelOf(record, names, isPrimary);
  }
}

interface PersonContext {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  primaryOrgId: Types.ObjectId;
  settings: ReadonlyMap<string, EffectiveRuleSetting>;
  today: string;
}

function dayOffModelOf(
  record: DayOffRecord,
  names: ReadonlyMap<string, string>,
  isPrimary: boolean,
): ScheduleDayOffModel {
  return {
    id: String(record._id),
    userId: String(record.userId),
    name: names.get(String(record.userId)) ?? "",
    date: record.date,
    kind: record.kind,
    startTime: record.startTime,
    endTime: record.endTime,
    note: record.note,
    isPrimary,
    byName: record.by === null ? null : (names.get(String(record.by)) ?? ""),
    reason: record.reason,
    reasonNote: record.reasonNote,
  };
}

/** 有畫休的日子:同日畫休人數只計主要分店的人。 */
function daysOf(
  records: readonly DayOffRecord[],
  names: ReadonlyMap<string, string>,
  primary: ReadonlySet<string>,
): ScheduleDayOffDayModel[] {
  const counts = dayOffStaffCounts(
    records
      .filter((record) => primary.has(String(record.userId)))
      .map((record) => toLike(record)),
  );
  const byDate = new Map<string, DayOffRecord[]>();
  for (const record of records) {
    byDate.set(record.date, [...(byDate.get(record.date) ?? []), record]);
  }
  return [...byDate.keys()]
    .toSorted((left, right) => left.localeCompare(right))
    .map((date) => ({
      date,
      staffCount: counts.get(date) ?? 0,
      dayOffs: (byDate.get(date) ?? [])
        .map((record) =>
          dayOffModelOf(record, names, primary.has(String(record.userId))),
        )
        .toSorted(byTime),
    }));
}

function validatedSlots(
  slots: readonly ScheduleDayOffSlotInput[] | null | undefined,
): { startTime: string; endTime: string }[] {
  const list = slots ?? [];
  const valid =
    list.length > 0 &&
    list.every(
      (slot) =>
        isHhMm(slot.startTime) &&
        isHhMm(slot.endTime) &&
        (minutesOfHhMm(slot.startTime) ?? 0) <
          (minutesOfHhMm(slot.endTime) ?? 0),
    );
  if (!valid) {
    throw validationError("time-range needs slots with start before end", [
      "slots",
    ]);
  }
  return list.map((slot) => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));
}

function validatedWrite(
  input: {
    date: string;
    kind: string;
    slots?: readonly ScheduleDayOffSlotInput[] | null;
  },
  who: { tenantId: Types.ObjectId; userId: Types.ObjectId },
): Pick<DayOffWrite, "tenantId" | "userId" | "date" | "kind" | "slots"> {
  if (!isIsoDate(input.date)) {
    throw validationError("date must be YYYY-MM-DD", ["date"]);
  }
  if (!isKind(input.kind)) {
    throw validationError(`unknown day off kind: ${input.kind}`, ["kind"]);
  }
  return {
    ...who,
    date: input.date,
    kind: input.kind,
    slots: input.kind === "time-range" ? validatedSlots(input.slots) : [],
  };
}

/** 整天畫休一天一筆;時段不可排之間(含這次送的幾段)不能重疊。 */
function assertNoConflict(
  existing: readonly DayOffRecord[],
  write: Pick<DayOffWrite, "date" | "kind" | "slots">,
): void {
  if (write.kind === "full-day") {
    if (existing.some((record) => record.kind === "full-day")) {
      throw validationError(`already has a full-day day off on ${write.date}`, [
        "kind",
      ]);
    }
    return;
  }
  const ranges = [
    ...existing.flatMap((record) =>
      record.kind === "time-range" &&
      record.startTime !== null &&
      record.endTime !== null
        ? [{ startTime: record.startTime, endTime: record.endTime }]
        : [],
    ),
  ];
  for (const slot of write.slots) {
    if (ranges.some((range) => overlaps(range, slot))) {
      throw validationError(
        `time ranges overlap on ${write.date}: ${slot.startTime}–${slot.endTime}`,
        ["slots"],
      );
    }
    ranges.push(slot);
  }
}

function auditOf(record: DayOffRecord): Record<string, unknown> {
  return {
    userId: record.userId,
    date: record.date,
    kind: record.kind,
    startTime: record.startTime,
    endTime: record.endTime,
    by: record.by,
    reason: record.reason,
    reasonNote: record.reasonNote,
  };
}
