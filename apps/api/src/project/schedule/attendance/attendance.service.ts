import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type AttendanceGrace,
  DEFAULT_ATTENDANCE_GRACE,
  attendanceOf,
} from "@repo/domain/project/schedule-settings";

import { AuditService } from "../../../audit/audit.service";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  ScheduleAttendancePunchesRepository,
  ScheduleEntriesRepository,
} from "../../database/schedule/roster.repositories";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import { PublishedEntries } from "../my/published-entries";
import { effectivePunchesOf, missingPunchesOf } from "../my/punch-rules";
import { type EntryRecord, RosterPeopleReader } from "../roster/roster-people";
import { ScheduleRulesService } from "../rules/schedule-rules.service";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  dateKeyOf,
  dayKeyRange,
  dayRangeOf,
  instantRangeFilter,
  monthKeyRange,
  monthOfWholeMonthRange,
  normalizedDay,
  shiftDateKey,
} from "../shared/schedule-dates";
import {
  SCHEDULE_REASONS,
  forbiddenError,
  notFoundError,
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
import { ScheduleStaffService } from "../staff/schedule-staff.service";
import type {
  ReassignSchedulePunchInput,
  ScheduleAttendanceByPersonInput,
  ScheduleAttendanceByStoreInput,
  ScheduleAttendanceExportInput,
} from "./dto/attendance.input";
import type {
  ScheduleAttendanceAbilitiesModel,
  ScheduleAttendanceByPersonPayload,
  ScheduleAttendanceByStorePayload,
  ScheduleAttendanceEntryOptionModel,
  ScheduleAttendanceExportPayload,
  ScheduleAttendancePunchModel,
  ScheduleAttendanceRowModel,
} from "./models/attendance.model";
import {
  type PunchRecord,
  SchedulePunchLedger,
  punchLikeOf,
} from "./punch-ledger";

/** 稽核的 targetType 與動作。 */
const PUNCH_TARGET = "schedule_attendance_punch";
export const PUNCH_REASSIGN_ACTION = "schedule-punch.reassign";

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

function graceOf(value: Record<string, unknown> | undefined): AttendanceGrace {
  const late = Number(value?.lateGraceMinutes);
  const early = Number(value?.earlyLeaveGraceMinutes);
  return {
    lateGraceMinutes: Number.isFinite(late)
      ? late
      : DEFAULT_ATTENDANCE_GRACE.lateGraceMinutes,
    earlyLeaveGraceMinutes: Number.isFinite(early)
      ? early
      : DEFAULT_ATTENDANCE_GRACE.earlyLeaveGraceMinutes,
  };
}

/** 讀出勤要的範圍:讀取用的上下文、租戶、時區。 */
interface ReadScope {
  reader: OperatorContext;
  tenantId: Types.ObjectId;
  timezone: string;
}

/**
 * 出勤紀錄(規格 14.7;正本 `docs/modules/project/schedule.md`「出勤紀錄與補打卡」):
 *
 * - **員工只看自己的**:沒有 `view-all` 時,依人員只能看自己(看別人 → `FORBIDDEN`)、依分店只列自己的班與卡
 * - 只列**已發布**月份的班(員工看得到的班表);上下班卡 = 生效的那兩張(上班取最早、下班取最晚)
 * - 遲到 / 早退的寬限用**班所在分店**的規則 `graceMinutes`(預設各 5 分鐘;差距大於寬限才算)
 * - 看自己的以租戶為邊界讀(支援別家店的班也列);看別人的照操作者的可見範圍
 * - [改對應排班](`reassign-punches`):原因必填、記 audit_log;只改對應排班,時間與類型不能改
 */
@Injectable()
export class ScheduleAttendanceService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly punches: ScheduleAttendancePunchesRepository,
    private readonly published: PublishedEntries,
    private readonly people: RosterPeopleReader,
    private readonly staff: ScheduleStaffService,
    private readonly rules: ScheduleRulesService,
    private readonly calendar: ScheduleCalendarService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
    private readonly permissions: SchedulePermissions,
    private readonly personLocks: SchedulePersonLocks,
    private readonly ledger: SchedulePunchLedger,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
    private readonly clock: ScheduleClock,
  ) {}

  async byPerson(
    operator: OperatorContext,
    input: ScheduleAttendanceByPersonInput,
  ): Promise<ScheduleAttendanceByPersonPayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const abilities = await this.abilitiesOf(operator);
    const self = this.selfOf(operator);
    const userId =
      input.userId === undefined || input.userId === null
        ? self
        : parseObjectId(input.userId, "userId");
    const scope = await this.readScopeOf(operator, org.tenantId, userId);
    if (!userId.equals(self) && !abilities.canViewAll) {
      throw forbiddenError(
        "missing permission schedule.attendance.view-all",
        "MISSING_PERMISSION",
      );
    }
    const month = this.wholeMonthOf(input, scope.timezone);
    const monthRange = monthKeyRange(month, scope.timezone);
    const entries = await this.publishedEntries(scope, {
      userId,
      date: instantRangeFilter(monthRange),
    });
    const punches = await this.punchesOf(scope, entries, {
      userId,
      at: instantRangeFilter(monthRange),
    });

    let people = [{ userId: String(self), name: "" }];
    if (abilities.canViewAll) {
      const candidates = await this.staff.listScheduleCandidates(
        operator,
        org.id,
      );
      people = candidates.map((item) => ({
        userId: item.userId,
        name: item.name,
      }));
      if (!people.some((item) => item.userId === String(userId))) {
        people.push({ userId: String(userId), name: "" });
      }
    }
    const names = await this.people.namesOf([
      ...people.map((item) => item.userId),
      userId,
    ]);
    const built = await this.build(operator, scope, entries, punches);
    return {
      month,
      orgId: String(org.id),
      userId: String(userId),
      people: people
        .map((item) => ({
          userId: item.userId,
          name: item.name === "" ? (names.get(item.userId) ?? "") : item.name,
        }))
        .toSorted((left, right) => compareScheduleNames(left.name, right.name)),
      rows: built.rows,
      unmatched: built.unmatched,
      abilities,
    };
  }

  async byStore(
    operator: OperatorContext,
    input: ScheduleAttendanceByStoreInput,
  ): Promise<ScheduleAttendanceByStorePayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const abilities = await this.abilitiesOf(operator);
    const own = abilities.canViewAll ? {} : { userId: this.selfOf(operator) };
    const scope: ReadScope = {
      reader: operator,
      tenantId: org.tenantId,
      timezone: await tenantTimezoneOf(this.orgs, operator, org.tenantId),
    };
    const date = normalizedDay(input.date, scope.timezone, "date");
    const entries = await this.publishedEntries(scope, {
      ...own,
      orgId: org.id,
      date,
    });
    const punches = await this.punchesOf(scope, entries, {
      ...own,
      orgId: org.id,
      at: instantRangeFilter(dayRangeOf(date, scope.timezone)),
    });
    const built = await this.build(operator, scope, entries, punches);
    return {
      orgId: String(org.id),
      orgName: org.name,
      date,
      rows: input.unmatchedOnly === true ? [] : built.rows,
      unmatched: built.unmatched,
      scheduledCount: built.rows.length,
      arrivedCount: built.rows.filter((row) => row.status === "arrived").length,
      absentCount: built.rows.filter((row) => row.status === "absent").length,
      abilities,
    };
  }

  /**
   * Excel 的資料(`export`):一家分店一個工作表 —— 選的組織與它看得到的下層分店,這個月的班;
   * 給 `userId` = 只有這個人(看別人要 `view-all`);沒給 = 全部的人(沒有 `view-all` 時只有自己)。
   */
  async exportRows(
    operator: OperatorContext,
    input: ScheduleAttendanceExportInput,
  ): Promise<ScheduleAttendanceExportPayload> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const abilities = await this.abilitiesOf(operator);
    const self = this.selfOf(operator);
    let userId: Types.ObjectId | null =
      input.userId === undefined || input.userId === null
        ? null
        : parseObjectId(input.userId, "userId");
    if (!abilities.canViewAll) {
      if (userId !== null && !userId.equals(self)) {
        throw forbiddenError(
          "missing permission schedule.attendance.view-all",
          "MISSING_PERMISSION",
        );
      }
      userId = self;
    }
    const scope: ReadScope = {
      reader: operator,
      tenantId: org.tenantId,
      timezone: await tenantTimezoneOf(this.orgs, operator, org.tenantId),
    };
    const month = this.wholeMonthOf(input, scope.timezone);
    const range = monthKeyRange(month, scope.timezone);
    const descendants = await this.orgs.findMany(scheduleOrgReader(operator), {
      ancestors: org.id,
    });
    const orgIds = [
      org.id,
      ...descendants
        .map((item) => item._id)
        .filter((id) => isOrgVisible(operator, id)),
    ];
    const entries = await this.publishedEntries(scope, {
      ...(userId === null ? {} : { userId }),
      orgId: { $in: orgIds },
      date: instantRangeFilter(range),
    });
    const punches = await this.punchesOf(scope, entries, null);
    const { rows } = await this.build(operator, scope, entries, punches);
    const byOrg = new Map<string, ScheduleAttendanceRowModel[]>();
    for (const row of rows) {
      const list = byOrg.get(row.orgId) ?? [];
      list.push(row);
      byOrg.set(row.orgId, list);
    }
    return {
      month,
      sheets: [...byOrg.entries()]
        .map(([orgId, list]) => ({
          orgId,
          orgName: list[0]?.orgName ?? "",
          rows: list,
        }))
        .toSorted((left, right) =>
          left.orgName.localeCompare(right.orgName, "zh-Hant"),
        ),
    };
  }

  /** [改對應排班] 可以選的排班:這個人打卡那天前後各一天、看得到的已發布排班。 */
  async entryOptionsOfPunch(
    operator: OperatorContext,
    punchId: string,
  ): Promise<ScheduleAttendanceEntryOptionModel[]> {
    const punch = await this.mustFindPunch(operator, punchId);
    const tenantId = this.tenantOf(punch);
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    const date = dateKeyOf(punch.at, timezone);
    const entries = await this.published.publishedOnly(
      operator,
      tenantId,
      await this.entries.findMany(
        operator,
        {
          tenantId,
          userId: punch.userId,
          date: instantRangeFilter(
            dayKeyRange(
              shiftDateKey(date, -1),
              shiftDateKey(date, 1),
              timezone,
            ),
          ),
        },
        { sort: { startAt: 1 } },
      ),
    );
    const [details, orgNames] = await Promise.all([
      this.published.detailsOf(operator, tenantId, entries),
      loadOrgNames(
        operator,
        this.orgs,
        entries.map((entry) => entry.orgId),
      ),
    ]);
    return entries.map((entry) => ({
      id: String(entry._id),
      orgId: String(entry.orgId),
      orgName: orgNames.get(String(entry.orgId)) ?? "",
      date: entry.date,
      startAt: entry.startAt,
      endAt: entry.endAt,
      shortName: details.get(String(entry._id))?.shortName ?? null,
    }));
  }

  /**
   * 改對應排班(規格 14.7、14.1):原因必填(欄位管理「改對應排班原因」啟用中的選項;「其他」說明必填),
   * 排班要是**同一個人**、看得到的已發布排班;卡的分店跟著排班。原本那一班與新的那一班重算重複打卡。
   * 時間與類型不能改。記 audit_log(before / after 的對應排班與原因)。
   */
  async reassign(
    operator: OperatorContext,
    input: ReassignSchedulePunchInput,
  ): Promise<ScheduleAttendancePunchModel> {
    const reasonKey = blankToNull(input.reasonKey);
    const reasonNote = blankToNull(input.reasonNote);
    if (reasonKey === null) {
      throw validationError("a reassign reason is required", ["reasonKey"]);
    }
    await this.fieldOptions.assertOptions(operator, [
      {
        categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason,
        value: reasonKey,
        field: "reasonKey",
      },
    ]);
    if (requiresReasonNote(reasonKey) && reasonNote === null) {
      throw validationError("reasonNote is required for other", ["reasonNote"]);
    }
    const punch = await this.mustFindPunch(operator, input.punchId);
    const tenantId = this.tenantOf(punch);
    let target: EntryRecord | null = null;
    if (input.entryId !== undefined && input.entryId !== null) {
      const id = parseObjectId(input.entryId, "entryId");
      const found = await this.entries.findOne(operator, {
        _id: id,
        tenantId,
        userId: punch.userId,
      });
      const [published] =
        found === null
          ? []
          : await this.published.publishedOnly(operator, tenantId, [found]);
      if (published === undefined) {
        throw validationError(
          `entry not found: ${input.entryId}`,
          ["entryId"],
          SCHEDULE_REASONS.referenceNotFound,
        );
      }
      target = published;
    }

    await this.personLocks.ensure(operator, tenantId, punch.userId);
    await this.transactions.withTransaction(async () => {
      await this.personLocks.touch(operator, tenantId, punch.userId);
      await this.ledger.reassign(
        operator,
        tenantId,
        [punch],
        target === null ? null : { entryId: target._id, orgId: target.orgId },
      );
      await this.audit.record(operator, {
        action: PUNCH_REASSIGN_ACTION,
        targetType: PUNCH_TARGET,
        targetId: punch._id,
        before: {
          entryId: punch.entryId === null ? null : String(punch.entryId),
        },
        after: {
          entryId: target === null ? null : String(target._id),
          reasonKey,
          reasonNote,
        },
      });
    });
    const updated = await this.punches.findById(operator, punch._id);
    if (!updated) {
      throw notFoundError(`punch not found: ${input.punchId}`);
    }
    const [model] = await this.punchModels(operator, [updated]);
    if (model === undefined) {
      throw notFoundError(`punch not found: ${input.punchId}`);
    }
    return model;
  }

  // ---- 內部 ----

  private selfOf(operator: OperatorContext): Types.ObjectId {
    if (operator.actorId === null) {
      throw notFoundError("no actor");
    }
    return operator.actorId;
  }

  private tenantOf(record: {
    tenantId: Types.ObjectId | null;
  }): Types.ObjectId {
    if (record.tenantId === null) {
      throw notFoundError("record has no tenant");
    }
    return record.tenantId;
  }

  async abilitiesOf(
    operator: OperatorContext,
  ): Promise<ScheduleAttendanceAbilitiesModel> {
    const holds = await this.permissions.holderOf(operator);
    return {
      canViewAll: holds(SCHEDULE_PERMISSIONS.attendanceViewAll),
      canReassign: holds(SCHEDULE_PERMISSIONS.reassignPunches),
      canExport: holds(SCHEDULE_PERMISSIONS.attendanceExport),
      canCreate: holds(SCHEDULE_PERMISSIONS.attendanceCreate),
    };
  }

  /** 看自己 = 以租戶為邊界(支援別家店的班也列);看別人 = 操作者的可見範圍。 */
  private async readScopeOf(
    operator: OperatorContext,
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<ReadScope> {
    const reader =
      operator.actorId !== null && userId.equals(operator.actorId)
        ? await tenantBoundaryContext(this.orgs, operator, tenantId)
        : operator;
    return {
      reader,
      tenantId,
      timezone: await tenantTimezoneOf(this.orgs, operator, tenantId),
    };
  }

  /** 月份查詢的 `from` / `to`(必填)→ 月份鍵;不是租戶時區的整個月 → `VALIDATION_FAILED`(`from`、`to`)。 */
  private wholeMonthOf(
    input: { from: Date; to: Date },
    timezone: string,
  ): string {
    const month = monthOfWholeMonthRange(input, timezone);
    if (month === null) {
      throw validationError("from / to are required", ["from", "to"]);
    }
    return month;
  }

  private async publishedEntries(
    scope: ReadScope,
    filter: Record<string, unknown>,
  ): Promise<EntryRecord[]> {
    return this.published.publishedOnly(
      scope.reader,
      scope.tenantId,
      await this.entries.findMany(
        scope.reader,
        { ...filter, tenantId: scope.tenantId },
        { sort: { startAt: 1 } },
      ),
    );
  }

  /** 這些班的卡 + (給了條件)符合條件的未對應排班的卡。 */
  private async punchesOf(
    scope: ReadScope,
    entries: readonly EntryRecord[],
    unmatched: Record<string, unknown> | null,
  ): Promise<PunchRecord[]> {
    const or: Record<string, unknown>[] = [];
    if (entries.length > 0) {
      or.push({ entryId: { $in: entries.map((entry) => entry._id) } });
    }
    if (unmatched !== null) {
      or.push({ ...unmatched, entryId: null });
    }
    if (or.length === 0) {
      return [];
    }
    return this.punches.findMany(
      scope.reader,
      { tenantId: scope.tenantId, $or: or },
      { sort: { at: 1, _id: 1 } },
    );
  }

  private async mustFindPunch(
    operator: OperatorContext,
    punchId: string,
  ): Promise<PunchRecord> {
    const punch = await this.punches.findById(
      operator,
      parseObjectId(punchId, "punchId"),
    );
    if (!punch) {
      throw notFoundError(`punch not found: ${punchId}`);
    }
    return punch;
  }

  private async punchModels(
    reader: OperatorContext,
    records: readonly PunchRecord[],
  ): Promise<ScheduleAttendancePunchModel[]> {
    const [names, orgNames] = await Promise.all([
      this.people.namesOf(records.map((record) => record.userId)),
      loadOrgNames(
        reader,
        this.orgs,
        records.map((record) => record.orgId),
      ),
    ]);
    return records.map((record) => ({
      id: String(record._id),
      userId: String(record.userId),
      userName: names.get(String(record.userId)) ?? "",
      orgId: String(record.orgId),
      orgName: orgNames.get(String(record.orgId)) ?? "",
      type: record.type,
      at: record.at,
      entryId: record.entryId === null ? null : String(record.entryId),
      source: record.source,
      duplicate: record.duplicate,
    }));
  }

  /** 排班 + 打卡 → 出勤列(依上班時點)與未對應排班的卡(依時間)。 */
  private async build(
    operator: OperatorContext,
    scope: ReadScope,
    entries: readonly EntryRecord[],
    punches: readonly PunchRecord[],
  ): Promise<{
    rows: ScheduleAttendanceRowModel[];
    unmatched: ScheduleAttendancePunchModel[];
  }> {
    const now = this.clock.now();
    const punchModels = await this.punchModels(scope.reader, punches);
    const likes = punches.map((record) => punchLikeOf(record));
    const orgIds = [
      ...new Map(entries.map((e) => [String(e.orgId), e.orgId])).values(),
    ];
    const keyOf = (date: Date) => dateKeyOf(date, scope.timezone);
    const dates = entries
      .map((entry) => keyOf(entry.date))
      .toSorted((left, right) => left.localeCompare(right));
    const [details, orgNames, names, categories] = await Promise.all([
      this.published.detailsOf(scope.reader, scope.tenantId, entries),
      loadOrgNames(scope.reader, this.orgs, orgIds),
      this.people.namesOf(entries.map((entry) => entry.userId)),
      entries.length === 0
        ? Promise.resolve([])
        : this.fieldOptions.options(
            operator,
            SCHEDULE_FIELD_CATEGORY_KEYS.specialDayCategory,
          ),
    ]);
    const categoryLabel = new Map(
      categories.map((option) => [option.value, option.label]),
    );
    const graceByOrg = new Map<string, AttendanceGrace>();
    const specialByOrgDate = new Map<
      string,
      { name: string | null; category: string | null }
    >();
    const first = dates.at(0);
    const last = dates.at(-1);
    for (const orgId of orgIds) {
      const settings = await this.rules.effectiveSettingsForOrg(
        scope.reader,
        orgId,
      );
      graceByOrg.set(
        String(orgId),
        graceOf(settings.get("graceMinutes")?.value),
      );
      if (first === undefined || last === undefined) {
        continue;
      }
      const days = await this.calendar.effectiveDays(
        scope.reader,
        orgId,
        dayKeyRange(first, last, scope.timezone),
      );
      for (const day of days) {
        if (day.type === "special") {
          specialByOrgDate.set(`${String(orgId)}|${keyOf(day.date)}`, {
            name: day.name,
            category:
              day.category === null
                ? null
                : (categoryLabel.get(day.category) ?? day.category),
          });
        }
      }
    }

    const rows = entries.map((entry): ScheduleAttendanceRowModel => {
      const id = String(entry._id);
      const { clockIn, clockOut } = effectivePunchesOf(id, likes);
      const attendance = attendanceOf(
        entry,
        clockIn,
        clockOut,
        graceByOrg.get(String(entry.orgId)) ?? DEFAULT_ATTENDANCE_GRACE,
        now,
      );
      const date = keyOf(entry.date);
      const special = specialByOrgDate.get(`${String(entry.orgId)}|${date}`);
      const own = punchModels.filter((punch) => punch.entryId === id);
      return {
        entryId: id,
        userId: String(entry.userId),
        userName: names.get(String(entry.userId)) ?? "",
        orgId: String(entry.orgId),
        orgName: orgNames.get(String(entry.orgId)) ?? "",
        date: entry.date,
        startAt: entry.startAt,
        endAt: entry.endAt,
        breakMinutes: entry.breakMinutes,
        shortName: details.get(id)?.shortName ?? null,
        clockIn,
        clockOut,
        ...attendance,
        missing: missingPunchesOf(
          { id, date, startAt: entry.startAt, endAt: entry.endAt },
          likes,
          now,
        ),
        specialDayName: special?.name ?? null,
        specialDayCategory: special?.category ?? null,
        hasMakeup: own.some((punch) => punch.source === "makeup"),
        punches: own,
      };
    });
    return {
      rows,
      unmatched: punchModels.filter((punch) => punch.entryId === null),
    };
  }
}
