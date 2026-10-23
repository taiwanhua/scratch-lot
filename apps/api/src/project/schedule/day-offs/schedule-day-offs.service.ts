import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Types } from "mongoose";

import {
  type InstantRange,
  addLocalMonths,
  localMonthRange,
  localMonthText,
  parseLocalMonth,
} from "@repo/domain/form";
import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_DAY_OFF_KINDS,
  type ScheduleDayOffKind,
  dayOffSlotsCoverDay,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import {
  OrgsRepository,
  UsersRepository,
} from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import { ScheduleEntriesRepository } from "../../database/schedule/roster.repositories";
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
  dateKeyOf,
  dayKeyRange,
  instantOfKey,
  localDateOfKey,
  monthKeyOf,
  monthKeyRange,
  monthOfWholeMonthRange,
  shiftDateKey,
  violationPeriodOf,
} from "../shared/schedule-dates";
import {
  SCHEDULE_REASONS,
  dayOffRuleError,
  forbiddenError,
  isDuplicateKeyError,
  notFoundError,
  savingUnique,
  validationError,
} from "../shared/schedule-error";
import {
  loadOrgNames,
  parseObjectId,
  resolveScheduleOrg,
  scheduleOrgReader,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import { SchedulePersonLocks } from "../shared/schedule-person-locks";
import { compareScheduleNames } from "../shared/schedule-sort";
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
  ScheduleDayOffEntryConflictModel,
  ScheduleDayOffLimitsModel,
  ScheduleDayOffModel,
  ScheduleDayOffOverviewPayload,
  ScheduleDayOffViolationModel,
  ScheduleDayOffWindowModel,
} from "./models/schedule-day-off.model";

type DayOffRecord = Persisted<ScheduleDayOffDocument>;

/**
 * 讀出來的一筆畫休(複製成純物件:文件是 Mongoose 文件,不能展開):存值 + 租戶時區的日期鍵
 * `localDate`(規則、分組、守門月份用它)。
 */
type LoadedDayOff = Pick<
  DayOffRecord,
  | "_id"
  | "orgId"
  | "userId"
  | "date"
  | "kind"
  | "startAt"
  | "endAt"
  | "note"
  | "by"
  | "reason"
  | "reasonNote"
> & { localDate: string };

function loadedOf(record: DayOffRecord, localDate: string): LoadedDayOff {
  return {
    _id: record._id,
    orgId: record.orgId,
    userId: record.userId,
    date: record.date,
    kind: record.kind,
    startAt: record.startAt,
    endAt: record.endAt,
    note: record.note,
    by: record.by,
    reason: record.reason,
    reasonNote: record.reasonNote,
    localDate,
  };
}

const ORG_STAFF = "org_schedule_staff";
const AUDIT_TARGET_TYPE = "schedule_day_off";
const DAY_OFF_WINDOW_KEY = "dayOffWindow";
const MS_PER_MINUTE = 60_000;

/** 讀使用者名稱用的上下文:`users` 不掛租戶過濾,範圍在此無作用,只為讓 BaseRepository 收得到上下文。 */
const NAMES_READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: [],
  managedOrgIds: [],
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

/** 時段不可排的一段(時點;落在那天、結束晚於開始)。 */
export interface ScheduleDayOffSpan {
  startAt: Date;
  endAt: Date;
}

/** 某個人某天不能排的時間(`listUnavailable`;給排班表、自動排班)。 */
export interface ScheduleUnavailability {
  userId: string;
  /** 那天(租戶時區 00:00 的時點) */
  date: Date;
  /** 有整天畫休 */
  fullDay: boolean;
  /** 時段不可排(時點;依開始時間) */
  slots: ScheduleDayOffSpan[];
}

/** 一次要寫的畫休(登記 / 代改共用)。 */
interface DayOffWrite {
  tenantId: Types.ObjectId;
  /** 歸屬組織:本人登記 = 當前組織;代改 = 總覽選的那家店 */
  ownerOrgId: Types.ObjectId;
  userId: Types.ObjectId;
  /** 那天租戶時區 00:00 的時點(存值) */
  date: Date;
  /** 那天的日期鍵 `YYYY-MM-DD` */
  localDate: string;
  kind: ScheduleDayOffKind;
  slots: ScheduleDayOffSpan[];
  note: string | null;
  by: Types.ObjectId | null;
  reason: string | null;
  reasonNote: string | null;
}

/**
 * 寫入要碰哪幾個月的守門文件:那天的月份;整天畫休另加前後一個月 ——「最多連續休假」會跨月,
 * 月初 / 月底的整天畫休和相鄰月份的寫入要互相衝突。依月份順序。守門文件以月份鍵 `YYYY-MM` 為鍵。
 */
export function dayOffLockMonths(date: string, kind: string): string[] {
  const { year, month } = localDateOfKey(date);
  const current = { year, month };
  return kind === "full-day"
    ? [
        localMonthText(addLocalMonths(current, -1)),
        localMonthText(current),
        localMonthText(addLocalMonths(current, 1)),
      ]
    : [localMonthText(current)];
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function isKind(value: string): value is ScheduleDayOffKind {
  return (SCHEDULE_DAY_OFF_KINDS as readonly string[]).includes(value);
}

/** 兩段時段重疊(頭尾相接不算)。 */
const overlaps = (left: ScheduleDayOffSpan, right: ScheduleDayOffSpan) =>
  left.startAt.getTime() < right.endAt.getTime() &&
  right.startAt.getTime() < left.endAt.getTime();

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
  timezone: string,
): ScheduleDayOffWindowModel {
  return {
    month: window.month,
    from: instantOfKey(window.startDate, timezone),
    to: instantOfKey(shiftDateKey(window.endDate, 1), timezone),
    state: dayOffWindowState(window, today),
    daysLeft: dayOffWindowDaysLeft(window, today),
  };
}

function violationModelOf(
  violation: ScheduleRuleViolation,
  timezone: string,
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
    dates: dates.map((date) => instantOfKey(date, timezone)),
    actual: violation.detail?.actual ?? null,
    limit: violation.detail?.limit ?? null,
    ...violationPeriodOf(violation.detail, timezone),
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

const toLike = (record: LoadedDayOff): DayOffLike => ({
  userId: String(record.userId),
  date: record.localDate,
  kind: record.kind,
});

/** 依日期、開始時間(整天畫休在前)、人名排序。 */
const byTime = (
  left: { localDate: string; startAt: Date | null; name?: string },
  right: { localDate: string; startAt: Date | null; name?: string },
) =>
  left.localDate.localeCompare(right.localDate) ||
  (left.startAt?.getTime() ?? 0) - (right.startAt?.getTime() ?? 0) ||
  compareScheduleNames(left.name ?? "", right.name ?? "");

/**
 * 畫休(規格 14.1 `schedule_day_offs`、14.2 畫休規則、14.5 畫休總覽、14.6 我的畫休;
 * 正本 `docs/modules/project/schedule.md`「畫休」)。
 *
 * - **屬於人**:一筆歸屬租戶頂層;那段時間所有分店都不能排
 * - **人的規則用主要分店的設定**;同日最多畫休人數只計以那家店為主要分店的人
 * - **本人**:只能在主要分店的開放期間內登記 / 刪除下個月;不需核准,違反限制不存
 * - **代改**(`schedule.manage.edit-day-offs`):不受開放期間限制;截止後原因必填,選「其他」要說明;記代改人
 * - 違反限制(存檔後限制的違反比存檔前多)→ `VALIDATION_FAILED`(`fields: ["date"]`、`violations`);提醒照存
 * - **日期與時段是時點**:輸入的 `date` 以租戶時區正規化成那天 00:00,時段 `[startAt, endAt)` 要在那天裡
 *   (結束最晚 = 隔天 00:00);
 *   月份查詢收 `from` / `to`(那個月的時點區間)。規則與分組在記憶體裡用租戶時區的日期鍵算
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
    private readonly personLocks: SchedulePersonLocks,
    private readonly entries: ScheduleEntriesRepository,
  ) {}

  onModuleInit(): void {
    registerDayOffRuleEvaluators();
  }

  // ---- 我的畫休 ----

  async mine(
    operator: OperatorContext,
    range: { from?: Date | null; to?: Date | null } | null | undefined,
  ): Promise<MyScheduleDayOffsPayload> {
    const { tenantId, userId } = await this.self(operator);
    const { today, timezone } = await this.today(operator, tenantId);
    const target =
      monthOfWholeMonthRange(range, timezone) ?? dayOffTargetMonth(today);
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
    // 畫休以人為準:主要分店不一定在操作者的可見範圍,以租戶為邊界讀它的生效設定
    const settings = await this.rules.effectiveSettingsForOrg(
      await tenantBoundaryContext(this.orgs, null, tenantId),
      primaryOrgId,
    );
    const window = windowModelOf(
      dayOffWindowFor(target, windowValueOf(settings)),
      today,
      timezone,
    );
    const members = await this.primaryMembersOf(tenantId, primaryOrgId);
    const records = await this.recordsAround(
      tenantId,
      [...new Set([...members, String(userId)])],
      target,
      timezone,
    );
    const names = await this.namesOf(records);
    const me = String(userId);
    const monthRecords = records.filter(
      (record) => monthKeyOf(record.localDate) === target,
    );
    const mine = monthRecords.filter((record) => String(record.userId) === me);
    const myDates = new Set(mine.map((record) => record.localDate));
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
      await tenantBoundaryContext(this.orgs, null, tenantId),
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
        .toSorted(byTime)
        .map((record) => dayOffModelOf(record, names, true)),
      days: daysOf(
        monthRecords.filter((record) =>
          members.includes(String(record.userId)),
        ),
        names,
        new Set(members),
        timezone,
      ),
      violations: violations
        .filter(
          (violation) =>
            violation.key !== DAY_OFF_STORE_RULE_KEY ||
            violation.targets.some(
              (item) => item.date !== undefined && myDates.has(item.date),
            ),
        )
        .map((violation) => violationModelOf(violation, timezone)),
    };
  }

  async addMine(
    operator: OperatorContext,
    input: AddMyScheduleDayOffsInput,
  ): Promise<SaveScheduleDayOffsPayload> {
    const { tenantId, orgId, userId } = await this.self(operator);
    const context = await this.personContext(operator, tenantId, userId);
    const write = validatedWrite(input, { tenantId, userId }, context.timezone);
    this.assertWindowOpen(context, write.localDate);
    return this.save(operator, context, {
      ...write,
      ownerOrgId: orgId,
      note: blankToNull(input.note),
      by: null,
      reason: null,
      reasonNote: null,
    });
  }

  async removeMine(operator: OperatorContext, id: string): Promise<string> {
    const { tenantId, userId } = await this.self(operator);
    const context = await this.personContext(operator, tenantId, userId);
    const record = await this.mustRecord(
      tenantId,
      id,
      [String(userId)],
      context.timezone,
    );
    this.assertWindowOpen(context, record.localDate);
    return this.remove(operator, context, record, null);
  }

  // ---- 畫休總覽、代改 ----

  async overview(
    operator: OperatorContext,
    orgId: string | null | undefined,
    range: { from?: Date | null; to?: Date | null } | null | undefined,
  ): Promise<ScheduleDayOffOverviewPayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const { today, timezone } = await this.today(operator, org.tenantId);
    const targetMonth = dayOffTargetMonth(today);
    const target = monthOfWholeMonthRange(range, timezone) ?? targetMonth;
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
      monthKeyRange(target, timezone),
      timezone,
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
      targetMonth,
      window: windowModelOf(
        dayOffWindowFor(target, windowValueOf(settings)),
        today,
        timezone,
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
      days: daysOf(records, names, primary, timezone),
    };
  }

  async addOnBehalf(
    operator: OperatorContext,
    input: AddScheduleDayOffsOnBehalfInput,
  ): Promise<SaveScheduleDayOffsPayload> {
    const { tenantId, orgId, userId } = await this.mustCandidate(
      operator,
      input.orgId,
      input.userId,
    );
    const context = await this.personContext(operator, tenantId, userId);
    const write = validatedWrite(input, { tenantId, userId }, context.timezone);
    const reason = await this.validatedReason(
      operator,
      context,
      write.localDate,
      {
        reason: input.reason,
        reasonNote: input.reasonNote,
      },
    );
    return this.save(operator, context, {
      ...write,
      ownerOrgId: orgId,
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
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    const record = await this.mustRecord(
      org.tenantId,
      input.id,
      candidates.map((candidate) => candidate.userId),
      timezone,
    );
    const context = await this.personContext(
      operator,
      org.tenantId,
      record.userId,
    );
    const reason = await this.validatedReason(
      operator,
      context,
      record.localDate,
      {
        reason: input.reason,
        reasonNote: input.reasonNote,
      },
    );
    return this.remove(operator, context, record, {
      by: operator.actorId,
      ...reason,
    });
  }

  // ---- 給其他功能 ----

  /**
   * 某家店的排班人員在一段期間(半開的時點區間 `[from, to)`)每天的
   * 整天畫休 / 時段不可排(給排班表、人力不足原因、自動排班;畫休屬於人,不分是在哪家店登記的)。
   * 只列有畫休的那幾天;這家店要在操作者的可見範圍內(看不到 → 空清單)。
   */
  async listUnavailable(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    range: InstantRange,
  ): Promise<ScheduleUnavailability[]> {
    // 這家店要在操作者(或排程的租戶系統身分)的可見範圍內;畫休屬於人,以租戶為邊界讀
    if (!isOrgVisible(operator, orgId)) {
      return [];
    }
    const org = await this.orgs.findById(scheduleOrgReader(operator), orgId);
    if (!org) {
      return [];
    }
    const [, tenantTop] = org.ancestors;
    const tenantId = tenantTop ?? org._id;
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const candidates = await this.staffService.listScheduleCandidates(
      reader,
      orgId,
    );
    const timezone = await tenantTimezoneOf(this.orgs, reader, tenantId);
    const records = await this.recordsBetween(
      tenantId,
      candidates.map((candidate) => candidate.userId),
      range,
      timezone,
    );
    return unavailabilityOf(records);
  }

  /**
   * 一個人在一段期間(半開的時點區間 `[from, to)`)每天的整天畫休 / 時段不可排,**以租戶與人為準**
   * (不經「某家店的候選人」:修改舊排班時,那個人可能已經不能排這家店,仍要擋)。
   * 給排班寫入檢查「畫休那段時間不能排」;租戶由呼叫端確認(操作者看得到的店所屬的租戶)。
   */
  async unavailableOfPerson(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
    range: InstantRange,
  ): Promise<ScheduleUnavailability[]> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const timezone = await tenantTimezoneOf(this.orgs, reader, tenantId);
    const records = await this.recordsBetween(
      tenantId,
      [String(userId)],
      range,
      timezone,
    );
    return unavailabilityOf(records);
  }

  /**
   * 這些人的主要分店(userId → 分店 id;沒有排班檔案或沒有主要分店的不在結果裡)。
   * 給排班檢核:人的規則用那個人主要分店的設定(規格 14.2)。以租戶為邊界讀(主要分店不一定看得到)。
   */
  async primaryOrgsOf(
    tenantId: Types.ObjectId,
    userIds: readonly string[],
  ): Promise<Map<string, Types.ObjectId>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
    const profiles = await this.staff.findMany(reader, {
      tenantId,
      userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    });
    if (profiles.length === 0) {
      return new Map();
    }
    const links = await this.relationships.findMany(reader, {
      type: ORG_STAFF,
      tenantId,
      secondId: { $in: profiles.map((profile) => profile._id) },
      "meta.isPrimary": true,
    });
    const userOfStaff = new Map(
      profiles.map((profile) => [String(profile._id), String(profile.userId)]),
    );
    return new Map(
      links.flatMap((link) => {
        const userId = userOfStaff.get(String(link.secondId));
        return userId === undefined ? [] : [[userId, link.firstId] as const];
      }),
    );
  }

  // ---- 內部 ----

  /** 登入者本人(在當前組織的租戶裡);`orgId` = 當前組織(本人登記的畫休歸屬它)。 */
  private async self(operator: OperatorContext): Promise<{
    tenantId: Types.ObjectId;
    orgId: Types.ObjectId;
    userId: Types.ObjectId;
  }> {
    const org = await resolveScheduleOrg(operator, this.orgs, null);
    if (operator.actorId === null) {
      throw forbiddenError("no actor", "MISSING_PERMISSION");
    }
    return { tenantId: org.tenantId, orgId: org.id, userId: operator.actorId };
  }

  /** 租戶時區與那個時區的今天(日期鍵)。 */
  private async today(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
  ): Promise<{ today: string; timezone: string }> {
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    return { today: dateKeyOf(this.clock.now(), timezone), timezone };
  }

  /**
   * 這個人的主要分店(沒有排班檔案、或沒有可以排的分店 → null)。
   * 排班檔案一人一份(唯一 `(tenantId, userId)`),主要分店每人一家。
   */
  private async primaryOrgOf(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
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
    const reader = await tenantBoundaryContext(this.orgs, null, tenantId);
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

  /** 檢查一個人的畫休要用的:主要分店、它的生效設定、租戶時區與今天。 */
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
        SCHEDULE_REASONS.noPrimaryStore,
      );
    }
    // 畫休以人為準:主要分店不一定在操作者的可見範圍,以租戶為邊界讀它的生效設定
    const settings = await this.rules.effectiveSettingsForOrg(
      await tenantBoundaryContext(this.orgs, null, tenantId),
      primaryOrgId,
    );
    const { today, timezone } = await this.today(operator, tenantId);
    return { tenantId, userId, primaryOrgId, settings, today, timezone };
  }

  /** 本人:這一天所在的月份要正在開放中(主要分店的開放期間)。 */
  private assertWindowOpen(context: PersonContext, date: string): void {
    const window = dayOffWindowFor(
      monthKeyOf(date),
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
      monthKeyOf(date),
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
  ): Promise<{
    tenantId: Types.ObjectId;
    orgId: Types.ObjectId;
    userId: Types.ObjectId;
  }> {
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const target = parseObjectId(userId, "userId");
    const candidates: ScheduleCandidate[] =
      await this.staffService.listScheduleCandidates(operator, org.id);
    if (!candidates.some((candidate) => candidate.userId === String(target))) {
      throw notFoundError(`schedule staff not found: ${userId}`);
    }
    return { tenantId: org.tenantId, orgId: org.id, userId: target };
  }

  /** 這個租戶裡、屬於這些人的一筆畫休;否則 `NOT_FOUND`。 */
  private async mustRecord(
    tenantId: Types.ObjectId,
    id: string,
    userIds: readonly string[],
    timezone: string,
  ): Promise<LoadedDayOff> {
    const record = await this.dayOffs.findOne(
      await tenantBoundaryContext(this.orgs, null, tenantId),
      { _id: parseObjectId(id, "id"), tenantId },
    );
    if (!record || !userIds.includes(String(record.userId))) {
      throw notFoundError(`day off not found: ${id}`);
    }
    return loadedOf(record, dateKeyOf(record.date, timezone));
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
    const like = {
      userId: String(write.userId),
      date: write.localDate,
      kind: write.kind,
    };
    const added: DayOffLike[] =
      write.kind === "full-day" ? [like] : write.slots.map(() => like);
    const rows: { startAt: Date | null; endAt: Date | null }[] =
      write.kind === "full-day"
        ? [{ startAt: null, endAt: null }]
        : write.slots;
    const withAdded = (entries: { like: DayOffLike }[]) => [
      ...entries.map((entry) => entry.like),
      ...added,
    ];
    const lockMonths = dayOffLockMonths(write.localDate, write.kind);
    await this.ensureLocks(operator, context, lockMonths);
    const { created, after } = await savingUnique(
      () =>
        this.transactions.withTransaction(async () => {
          await this.touchLocks(operator, context, lockMonths);
          const existing = await this.recordsBetween(
            context.tenantId,
            [String(context.userId)],
            dayKeyRange(write.localDate, write.localDate, context.timezone),
            context.timezone,
          );
          assertNoConflict(existing, write);
          const violations = await this.assertRules(
            context,
            write.localDate,
            withAdded,
          );
          const items: LoadedDayOff[] = [];
          for (const row of rows) {
            const record = await this.dayOffs.create(
              await tenantBoundaryContext(
                this.orgs,
                operator,
                context.tenantId,
              ),
              {
                orgId: write.ownerOrgId,
                userId: write.userId,
                date: write.date,
                kind: write.kind,
                startAt: row.startAt,
                endAt: row.endAt,
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
            items.push(loadedOf(record, write.localDate));
          }
          return { created: items, after: violations };
        }),
      `already has a full-day day off on ${write.localDate}`,
      ["kind"],
      SCHEDULE_REASONS.dayOffDuplicate,
    );
    const names = await this.namesOf(created);
    return {
      items: created.map((record) => dayOffModelOf(record, names, true)),
      violations: after.map((violation) =>
        violationModelOf(violation, context.timezone),
      ),
      entryConflicts: await this.entryConflictsOf(operator, context, write),
    };
  }

  /**
   * 先排班、後登記畫休(使用者定案:照樣可以登記,但要提醒):這段畫休和這個人已有的排班(整個租戶,
   * 跨店也算)重疊的,列出日期、時間與分店名稱(看不到的分店不帶名稱)。頭尾相接不算重疊。
   */
  private async entryConflictsOf(
    operator: OperatorContext,
    context: PersonContext,
    write: DayOffWrite,
  ): Promise<ScheduleDayOffEntryConflictModel[]> {
    const windows =
      write.kind === "full-day"
        ? [dayKeyRange(write.localDate, write.localDate, context.timezone)]
        : write.slots.map((slot) => ({
            from: slot.startAt.getTime(),
            to: slot.endAt.getTime(),
          }));
    const from = Math.min(...windows.map((window) => window.from));
    const to = Math.max(...windows.map((window) => window.to));
    const records = await this.entries.findMany(
      await tenantBoundaryContext(this.orgs, operator, context.tenantId),
      {
        tenantId: context.tenantId,
        userId: context.userId,
        startAt: { $lt: new Date(to) },
        endAt: { $gt: new Date(from) },
      },
      { sort: { startAt: 1 } },
    );
    const conflicts = records.filter((record) =>
      windows.some(
        (window) =>
          record.startAt.getTime() < window.to &&
          record.endAt.getTime() > window.from,
      ),
    );
    const names = await loadOrgNames(
      operator,
      this.orgs,
      conflicts
        .map((record) => record.orgId)
        .filter((orgId) => isOrgVisible(operator, orgId)),
    );
    return conflicts.map((record) => ({
      // 排班那天(排班的 `date`:上班時點在租戶時區那天的 00:00)
      date: record.date,
      startAt: record.startAt,
      endAt: record.endAt,
      orgName: isOrgVisible(operator, record.orgId)
        ? (names.get(String(record.orgId)) ?? null)
        : null,
    }));
  }

  /** 刪除:同登記,規則檢查與寫入在同一個交易、交易一開始先碰守門文件。 */
  private async remove(
    operator: OperatorContext,
    context: PersonContext,
    record: LoadedDayOff,
    override: {
      by: Types.ObjectId | null;
      reason: string | null;
      reasonNote: string | null;
    } | null,
  ): Promise<string> {
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      context.tenantId,
    );
    const lockMonths = [monthKeyOf(record.localDate)];
    await this.ensureLocks(operator, context, lockMonths);
    await this.transactions.withTransaction(async () => {
      await this.touchLocks(operator, context, lockMonths);
      const current = await this.dayOffs.findOne(writer, {
        _id: record._id,
        tenantId: context.tenantId,
      });
      if (!current) {
        throw notFoundError(`day off not found: ${String(record._id)}`);
      }
      await this.assertRules(context, record.localDate, (entries) =>
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
  private async ensureLocks(
    operator: OperatorContext,
    context: PersonContext,
    months: readonly string[],
  ): Promise<void> {
    // 排班寫入的「人」守門文件也先建好(交易裡一起碰:畫休與排班同時寫同一人互相衝突)
    await this.personLocks.ensure(operator, context.tenantId, context.userId);
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      context.tenantId,
    );
    for (const month of months) {
      const key = {
        orgId: context.tenantId,
        storeId: context.primaryOrgId,
        month,
      };
      const existing = await this.locks.findOne(writer, key);
      if (existing) {
        continue;
      }
      try {
        await this.locks.create(writer, {
          ...key,
          version: 0,
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
      }
    }
  }

  /**
   * 交易一開始對守門文件 `$inc`(依月份順序):之後讀到的畫休就是這一刻之後的快照,同時寫入的另一方
   * 會衝突重跑。碰不到文件(應該已在交易外建好)→ 丟錯,不靜默失去保護。
   */
  private async touchLocks(
    operator: OperatorContext,
    context: PersonContext,
    months: readonly string[],
  ): Promise<void> {
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      context.tenantId,
    );
    // 同一個人的排班寫入(`schedule_entry_locks`)也在交易一開始碰:登記畫休與排班同時送出不會互相繞過
    await this.personLocks.touch(operator, context.tenantId, context.userId);
    for (const month of months) {
      const touched = await this.locks.findOneAndUpdate(
        writer,
        { orgId: context.tenantId, storeId: context.primaryOrgId, month },
        { $inc: { version: 1 } },
      );
      if (!touched) {
        throw new Error(
          `day-off lock missing: store ${String(context.primaryOrgId)} ${month}`,
        );
      }
    }
  }

  /**
   * 跑畫休規則,存檔後限制的違反比存檔前多(新的、或更嚴重)→ 擋下並回原因;回存檔後涉及這個人的違反。
   * 店的規則只看這次改的那一天(日期鍵)。
   */
  private async assertRules(
    context: PersonContext,
    date: string,
    change: (entries: { id: string; like: DayOffLike }[]) => DayOffLike[],
  ): Promise<ScheduleRuleViolation[]> {
    const month = monthKeyOf(date);
    const members = await this.primaryMembersOf(
      context.tenantId,
      context.primaryOrgId,
    );
    const me = String(context.userId);
    const records = await this.recordsAround(
      context.tenantId,
      [...new Set([...members, me])],
      month,
      context.timezone,
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
          .map((violation) => violationModelOf(violation, context.timezone)),
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

  /** 這些人在某個月(月份鍵)前後各一個月的畫休(連續休假會跨月)。 */
  private recordsAround(
    tenantId: Types.ObjectId,
    userIds: readonly string[],
    month: string,
    timezone: string,
  ): Promise<LoadedDayOff[]> {
    const parsed = parseLocalMonth(month);
    if (parsed === null) {
      throw new RangeError(`invalid month key: ${month}`);
    }
    return this.recordsBetween(
      tenantId,
      userIds,
      {
        from: localMonthRange(addLocalMonths(parsed, -1), timezone).from,
        to: localMonthRange(addLocalMonths(parsed, 1), timezone).to,
      },
      timezone,
    );
  }

  /** 這些人在時點區間 `[from, to)` 裡的畫休,每筆帶租戶時區的日期鍵。 */
  private async recordsBetween(
    tenantId: Types.ObjectId,
    userIds: readonly string[],
    range: InstantRange,
    timezone: string,
  ): Promise<LoadedDayOff[]> {
    if (userIds.length === 0) {
      return [];
    }
    const records = await this.dayOffs.findMany(
      await tenantBoundaryContext(this.orgs, null, tenantId),
      {
        tenantId,
        userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
        date: { $gte: new Date(range.from), $lt: new Date(range.to) },
      },
    );
    return records.map((record) =>
      loadedOf(record, dateKeyOf(record.date, timezone)),
    );
  }

  /** 畫休的人與代改人的名稱。 */
  private async namesOf(
    records: readonly Pick<DayOffRecord, "userId" | "by">[],
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
    records: readonly Pick<DayOffRecord, "by">[],
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
    // users 是關聯歸屬資料(不掛租戶過濾),條件釘死在明列的 id 上
    const users = await this.users.findMany(NAMES_READER, {
      _id: { $in: missing.map((id) => new Types.ObjectId(id)) },
    });
    for (const user of users) {
      names.set(String(user._id), user.name);
    }
  }
}

interface PersonContext {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  primaryOrgId: Types.ObjectId;
  settings: ReadonlyMap<string, EffectiveRuleSetting>;
  /** 租戶時區的今天(日期鍵) */
  today: string;
  timezone: string;
}

function dayOffModelOf(
  record: LoadedDayOff,
  names: ReadonlyMap<string, string>,
  isPrimary: boolean,
): ScheduleDayOffModel {
  return {
    id: String(record._id),
    userId: String(record.userId),
    name: names.get(String(record.userId)) ?? "",
    date: record.date,
    kind: record.kind,
    startAt: record.startAt,
    endAt: record.endAt,
    note: record.note,
    isPrimary,
    byName: record.by === null ? null : (names.get(String(record.by)) ?? ""),
    reason: record.reason,
    reasonNote: record.reasonNote,
  };
}

/** 有畫休的日子:同日畫休人數只計主要分店的人。 */
function daysOf(
  records: readonly LoadedDayOff[],
  names: ReadonlyMap<string, string>,
  primary: ReadonlySet<string>,
  timezone: string,
): ScheduleDayOffDayModel[] {
  const counts = dayOffStaffCounts(
    records
      .filter((record) => primary.has(String(record.userId)))
      .map((record) => toLike(record)),
  );
  const byDate = new Map<string, LoadedDayOff[]>();
  for (const record of records) {
    byDate.set(record.localDate, [
      ...(byDate.get(record.localDate) ?? []),
      record,
    ]);
  }
  return [...byDate.keys()]
    .toSorted((left, right) => left.localeCompare(right))
    .map((date) => ({
      date: instantOfKey(date, timezone),
      staffCount: counts.get(date) ?? 0,
      dayOffs: (byDate.get(date) ?? [])
        .map((record) => ({
          record,
          localDate: record.localDate,
          startAt: record.startAt,
          name: names.get(String(record.userId)) ?? "",
        }))
        .toSorted(byTime)
        .map(({ record }) =>
          dayOffModelOf(record, names, primary.has(String(record.userId))),
        ),
    }));
}

/** 合法時點、精度到分鐘。 */
const onMinute = (instant: number): boolean =>
  Number.isFinite(instant) && instant % MS_PER_MINUTE === 0;

/**
 * 時段不可排的幾段:至少一段;每段是那天裡的半開區間 `[startAt, endAt)`:開始落在
 * `[那天 00:00, 隔天 00:00)`、結束晚於開始且最晚 = 隔天 00:00(做到當天結束)、精度到分鐘
 * (admin 由日期 + `HH:mm` 合成,結束選 00:00 = 隔天 00:00);這次送的幾段合起來蓋滿那一天
 * (一段 00:00–隔天 00:00,或重疊 / 相接的幾段;`dayOffSlotsCoverDay`,admin 同一條規則、停用儲存)也不收,
 * 整天要登記整天畫休。
 * 不合規則 → `VALIDATION_FAILED`(欄位 `slots`,格式錯不帶 reason)。
 */
function validatedSlots(
  slots: readonly ScheduleDayOffSlotInput[] | null | undefined,
  day: InstantRange,
): ScheduleDayOffSpan[] {
  const list = slots ?? [];
  const valid =
    list.length > 0 &&
    list.every((slot) => {
      const start = slot.startAt.getTime();
      const end = slot.endAt.getTime();
      return (
        onMinute(start) &&
        onMinute(end) &&
        start >= day.from &&
        start < end &&
        end <= day.to
      );
    });
  if (!valid) {
    throw validationError(
      "time-range needs slots on that day with start before end",
      ["slots"],
    );
  }
  const wholeDay = dayOffSlotsCoverDay(
    list.map((slot) => ({
      startAt: slot.startAt.getTime(),
      endAt: slot.endAt.getTime(),
    })),
    { startAt: day.from, endAt: day.to },
  );
  if (wholeDay) {
    throw validationError(
      "time-range slots covering the whole day must be a full-day day off",
      ["slots"],
    );
  }
  return list.map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt }));
}

function validatedWrite(
  input: {
    date: Date;
    kind: string;
    slots?: readonly ScheduleDayOffSlotInput[] | null;
  },
  who: { tenantId: Types.ObjectId; userId: Types.ObjectId },
  timezone: string,
): Pick<
  DayOffWrite,
  "tenantId" | "userId" | "date" | "localDate" | "kind" | "slots"
> {
  const instant = input.date.getTime();
  if (!Number.isFinite(instant)) {
    throw validationError("date must be an instant", ["date"]);
  }
  if (!isKind(input.kind)) {
    throw validationError(`unknown day off kind: ${input.kind}`, ["kind"]);
  }
  // 以租戶時區正規化成那天 00:00(admin 送的就是 00:00;送了當天其他時刻也歸到同一天)
  const localDate = dateKeyOf(input.date, timezone);
  const day = dayKeyRange(localDate, localDate, timezone);
  return {
    ...who,
    date: new Date(day.from),
    localDate,
    kind: input.kind,
    slots: input.kind === "time-range" ? validatedSlots(input.slots, day) : [],
  };
}

/** 整天畫休一天一筆;時段不可排之間(含這次送的幾段)不能重疊。 */
function assertNoConflict(
  existing: readonly LoadedDayOff[],
  write: Pick<DayOffWrite, "localDate" | "kind" | "slots">,
): void {
  if (write.kind === "full-day") {
    if (existing.some((record) => record.kind === "full-day")) {
      throw validationError(
        `already has a full-day day off on ${write.localDate}`,
        ["kind"],
        SCHEDULE_REASONS.dayOffDuplicate,
      );
    }
    return;
  }
  const ranges: ScheduleDayOffSpan[] = existing.flatMap((record) =>
    record.kind === "time-range" &&
    record.startAt !== null &&
    record.endAt !== null
      ? [{ startAt: record.startAt, endAt: record.endAt }]
      : [],
  );
  for (const slot of write.slots) {
    if (ranges.some((range) => overlaps(range, slot))) {
      throw validationError(
        `time ranges overlap on ${write.localDate}: ${slot.startAt.toISOString()}–${slot.endAt.toISOString()}`,
        ["slots"],
        SCHEDULE_REASONS.timeRangesOverlap,
      );
    }
    ranges.push(slot);
  }
}

function auditOf(
  record: Pick<
    DayOffRecord,
    | "userId"
    | "date"
    | "kind"
    | "startAt"
    | "endAt"
    | "by"
    | "reason"
    | "reasonNote"
  >,
): Record<string, unknown> {
  return {
    userId: record.userId,
    date: record.date,
    kind: record.kind,
    startAt: record.startAt,
    endAt: record.endAt,
    by: record.by,
    reason: record.reason,
    reasonNote: record.reasonNote,
  };
}

/** 畫休紀錄 → 每人每天的整天畫休 / 時段不可排(時段依開始時間)。 */
function unavailabilityOf(
  records: readonly LoadedDayOff[],
): ScheduleUnavailability[] {
  const byKey = new Map<string, ScheduleUnavailability>();
  for (const record of records.toSorted(byTime)) {
    const key = `${String(record.userId)}|${record.localDate}`;
    const item = byKey.get(key) ?? {
      userId: String(record.userId),
      date: record.date,
      fullDay: false,
      slots: [],
    };
    if (record.kind === "full-day") {
      item.fullDay = true;
    } else if (record.startAt !== null && record.endAt !== null) {
      item.slots.push({ startAt: record.startAt, endAt: record.endAt });
    }
    byKey.set(key, item);
  }
  return [...byKey.values()];
}
