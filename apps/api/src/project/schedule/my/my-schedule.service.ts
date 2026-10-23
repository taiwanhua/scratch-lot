import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { startOfLocalDayOf } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_PUNCH_TYPES,
  type SchedulePunchType,
} from "@repo/domain/project/schedule-settings";

import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { TransactionService } from "../../../database/transaction";
import {
  ScheduleAttendancePunchesRepository,
  ScheduleChangesRepository,
  ScheduleEntriesRepository,
} from "../../database/schedule/roster.repositories";
import {
  type PunchRecord,
  SchedulePunchLedger,
  punchLikeOf,
} from "../attendance/punch-ledger";
import { ScheduleCalendarService } from "../calendar/schedule-calendar.service";
import { ScheduleDayOffsService } from "../day-offs/schedule-day-offs.service";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import type { EntryRecord } from "../roster/roster-people";
import { ScheduleClock } from "../shared/schedule-clock";
import {
  dateKeyOf,
  instantOfKey,
  instantRangeFilter,
  monthKeyOf,
  monthKeyRange,
  monthOfWholeMonthRange,
  shiftDateKey,
} from "../shared/schedule-dates";
import {
  SCHEDULE_REASONS,
  notFoundError,
  validationError,
} from "../shared/schedule-error";
import {
  type ScheduleOrg,
  loadOrgNames,
  parseObjectId,
  resolveScheduleOrg,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import { SchedulePersonLocks } from "../shared/schedule-person-locks";
import type {
  MyScheduleChangeModel,
  MyScheduleEntryModel,
  MySchedulePayload,
  MySchedulePunchModel,
} from "./models/my-schedule.model";
import { type EntryDetail, PublishedEntries } from "./published-entries";
import {
  type PunchLike,
  canPunchEntry,
  effectivePunchesOf,
  incompleteEntriesOf,
  missingPunchesOf,
  openUnmatchedClockInOf,
  punchableEntriesOf,
} from "./punch-rules";

/** 打卡不完整提醒看最近幾天(含今天)。 */
export const INCOMPLETE_LOOKBACK_DAYS = 7;

export function punchModelOf(record: PunchRecord): MySchedulePunchModel {
  return {
    id: String(record._id),
    type: record.type,
    at: record.at,
    entryId: record.entryId === null ? null : String(record.entryId),
    orgId: String(record.orgId),
    duplicate: record.duplicate,
  };
}

const dateOrNull = (value: unknown): Date | null =>
  value instanceof Date ? value : null;

/** 打卡的請求資訊(`ip`、`userAgent`)。 */
export interface PunchRequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** 我(登入者)在當前組織所屬租戶裡的身分。 */
interface Self {
  org: ScheduleOrg;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
}

/**
 * 我的班表 → 班表分頁與打卡(規格 14.6;正本 `docs/modules/project/schedule.md`「我的班表」)。
 *
 * - **以人為準**:我的班跨分店合併顯示,分店不一定在我的可見範圍(支援別家店)—— 以租戶為邊界讀
 *   (`tenantBoundaryContext`,用途「以人為準的資料」);只讀**已發布**月份的班
 * - 打卡寫在班所在的分店(可能看不到,用途「例外寫入」);「沒有排班」打的卡記在當前組織、未對應排班
 * - 同一班同類型多張:上班取最早、下班取最晚,其餘標重複(寫入時在交易內重算,以「人」守門文件序列化)
 * - 缺卡不存,讀取時計算
 */
@Injectable()
export class MyScheduleService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly punches: ScheduleAttendancePunchesRepository,
    private readonly changes: ScheduleChangesRepository,
    private readonly published: PublishedEntries,
    private readonly calendar: ScheduleCalendarService,
    private readonly dayOffs: ScheduleDayOffsService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
    private readonly permissions: SchedulePermissions,
    private readonly personLocks: SchedulePersonLocks,
    private readonly transactions: TransactionService,
    private readonly clock: ScheduleClock,
    private readonly ledger: SchedulePunchLedger,
  ) {}

  async mySchedule(
    operator: OperatorContext,
    range: { from?: Date | null; to?: Date | null } | null | undefined,
  ): Promise<MySchedulePayload> {
    const self = await this.self(operator);
    const now = this.clock.now();
    const timezone = await tenantTimezoneOf(this.orgs, operator, self.tenantId);
    const keyOf = (date: Date) => dateKeyOf(date, timezone);
    const today = dateKeyOf(now, timezone);
    const target = monthOfWholeMonthRange(range, timezone) ?? monthKeyOf(today);
    const own = monthKeyRange(target, timezone);
    const inMonth = (date: Date) =>
      date.getTime() >= own.from && date.getTime() < own.to;
    const yesterday = shiftDateKey(today, -1);
    const lookbackFrom = shiftDateKey(today, 1 - INCOMPLETE_LOOKBACK_DAYS);
    const reader = await tenantBoundaryContext(
      this.orgs,
      operator,
      self.tenantId,
    );

    // 讀這個月 ∪ 最近 7 天(打卡不完整提醒、打卡區可能跨月)
    const read = {
      from: Math.min(own.from, instantOfKey(lookbackFrom, timezone).getTime()),
      to: Math.max(
        own.to,
        instantOfKey(shiftDateKey(today, 1), timezone).getTime(),
      ),
    };
    const entries = await this.published.publishedOnly(
      reader,
      self.tenantId,
      await this.entries.findMany(
        reader,
        {
          tenantId: self.tenantId,
          userId: self.userId,
          date: instantRangeFilter(read),
        },
        { sort: { startAt: 1 } },
      ),
    );
    const startOfToday = new Date(startOfLocalDayOf(now.getTime(), timezone));
    const punches = await this.punches.findMany(
      reader,
      {
        tenantId: self.tenantId,
        userId: self.userId,
        $or: [
          { entryId: { $in: entries.map((entry) => entry._id) } },
          { entryId: null, at: { $gte: startOfToday } },
        ],
      },
      { sort: { at: 1, _id: 1 } },
    );
    const punchLikes = punches.map((record) => punchLikeOf(record));
    const [details, orgNames] = await Promise.all([
      this.published.detailsOf(reader, self.tenantId, entries),
      loadOrgNames(
        reader,
        this.orgs,
        entries.map((entry) => entry.orgId),
      ),
    ]);
    const modelOf = (entry: EntryRecord): MyScheduleEntryModel =>
      entryModelOf(entry, {
        detail: details.get(String(entry._id)),
        orgName: orgNames.get(String(entry.orgId)) ?? "",
        punches: punchLikes,
        now,
        timezone,
      });
    const likes = entries.map((entry) => ({
      id: String(entry._id),
      date: keyOf(entry.date),
      startAt: entry.startAt,
      endAt: entry.endAt,
      record: entry,
    }));
    // 未對應排班的卡只讀了今天的(見上方查詢)
    const openUnmatched = openUnmatchedClockInOf(
      punches.map((record) => ({ ...punchLikeOf(record), record })),
    );

    const holds = await this.permissions.holderOf(operator);
    const [changes, calendarDays, dayOffs] = await Promise.all([
      this.recentChanges(operator, reader, self, instantOfKey(today, timezone)),
      this.calendar.effectiveDays(operator, self.org.id, own),
      this.dayOffs.unavailableOfPerson(self.tenantId, self.userId, own),
    ]);

    return {
      month: target,
      today: instantOfKey(today, timezone),
      canPunch: holds(SCHEDULE_PERMISSIONS.myPunch),
      currentOrg: { id: String(self.org.id), name: self.org.name },
      entries: entries
        .filter((entry) => inMonth(entry.date))
        .map((entry) => modelOf(entry)),
      punchCards: punchableEntriesOf(likes, punchLikes, {
        today,
        yesterday,
      }).map((item) => ({ day: item.day, entry: modelOf(item.entry.record) })),
      hasEntryToday: entries.some((entry) => keyOf(entry.date) === today),
      openUnmatchedClockIn:
        openUnmatched === null ? null : punchModelOf(openUnmatched.record),
      incomplete: incompleteEntriesOf(likes, punchLikes, now, {
        from: lookbackFrom,
        to: today,
      }).map((item) => modelOf(item.entry.record)),
      changes,
      calendarDays: calendarDays.map((day) => ({
        date: day.date,
        type: day.type,
        name: day.name,
        paletteKey: day.paletteKey,
      })),
      dayOffDates: dayOffs.filter((day) => day.fullDay).map((day) => day.date),
    };
  }

  /**
   * 打卡:`entryId` = 在那張排班卡片上打(今天的班兩種都可以;昨天未打下班卡的班只能打下班卡);
   * 不給 = 「沒有排班」區塊(記在當前組織、未對應排班)。時間由伺服器決定。
   */
  async punch(
    operator: OperatorContext,
    input: { type: string; entryId?: string | null },
    meta: PunchRequestMeta,
  ): Promise<MySchedulePunchModel> {
    const self = await this.self(operator);
    return this.punchFor(operator, self, input, meta);
  }

  /** 給刮刮樂開班彈窗 [打卡]:打這一班的上班卡(`integration/entry-lookup.ts` 呼叫)。 */
  async punchStartOf(
    operator: OperatorContext,
    entryId: string,
    meta: PunchRequestMeta,
  ): Promise<MySchedulePunchModel> {
    return this.punch(operator, { type: "in", entryId }, meta);
  }

  // ---- 內部 ----

  private async punchFor(
    operator: OperatorContext,
    self: Self,
    input: { type: string; entryId?: string | null },
    meta: PunchRequestMeta,
  ): Promise<MySchedulePunchModel> {
    if (!SCHEDULE_PUNCH_TYPES.includes(input.type as SchedulePunchType)) {
      throw validationError(`invalid punch type: ${input.type}`, ["type"]);
    }
    const type = input.type as SchedulePunchType;
    const now = this.clock.now();
    const writer = await tenantBoundaryContext(
      this.orgs,
      operator,
      self.tenantId,
    );
    let orgId = self.org.id;
    let entryId: Types.ObjectId | null = null;
    if (input.entryId !== undefined && input.entryId !== null) {
      const entry = await this.mustOwnPublishedEntry(
        writer,
        self,
        parseObjectId(input.entryId, "entryId"),
      );
      const timezone = await tenantTimezoneOf(
        this.orgs,
        operator,
        self.tenantId,
      );
      const today = dateKeyOf(now, timezone);
      const existing = await this.punches.findMany(writer, {
        tenantId: self.tenantId,
        entryId: entry._id,
      });
      if (
        !canPunchEntry(
          {
            id: String(entry._id),
            date: dateKeyOf(entry.date, timezone),
            startAt: entry.startAt,
            endAt: entry.endAt,
          },
          type,
          existing.map((record) => punchLikeOf(record)),
          { today, yesterday: shiftDateKey(today, -1) },
        )
      ) {
        throw validationError(
          `entry ${String(entry._id)} cannot take a ${type} punch now`,
          ["entryId"],
          SCHEDULE_REASONS.punchNotAllowed,
        );
      }
      orgId = entry.orgId;
      entryId = entry._id;
    }

    await this.personLocks.ensure(operator, self.tenantId, self.userId);
    const created = await this.transactions.withTransaction(async () => {
      await this.personLocks.touch(operator, self.tenantId, self.userId);
      const record = await this.punches.create(writer, {
        orgId,
        userId: self.userId,
        at: now,
        type,
        entryId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        source: "button",
        makeupRequestId: null,
        duplicate: false,
      });
      if (entryId === null) {
        return record;
      }
      const marked = await this.markDuplicates(writer, self.tenantId, entryId);
      return marked.get(String(record._id)) ?? record;
    });
    return punchModelOf(created);
  }

  /** 重算一班的「重複打卡」標記(`SchedulePunchLedger.markDuplicates`;在交易內呼叫)。 */
  markDuplicates(
    writer: OperatorContext,
    tenantId: Types.ObjectId,
    entryId: Types.ObjectId,
  ): Promise<Map<string, PunchRecord>> {
    return this.ledger.markDuplicates(writer, tenantId, entryId);
  }

  private async mustOwnPublishedEntry(
    reader: OperatorContext,
    self: Self,
    id: Types.ObjectId,
  ): Promise<EntryRecord> {
    const entry = await this.entries.findOne(reader, {
      _id: id,
      tenantId: self.tenantId,
      userId: self.userId,
    });
    const [published] =
      entry === null
        ? []
        : await this.published.publishedOnly(reader, self.tenantId, [entry]);
    if (published === undefined) {
      throw notFoundError(`entry not found: ${String(id)}`);
    }
    return published;
  }

  /** 最近異動:我牽涉的、還沒到(異動那天 ≥ 今天)的班的異動,新到舊。 */
  private async recentChanges(
    operator: OperatorContext,
    reader: OperatorContext,
    self: Self,
    today: Date,
  ): Promise<MyScheduleChangeModel[]> {
    const rows = await this.changes.findMany(
      reader,
      { tenantId: self.tenantId, userIds: self.userId, date: { $gte: today } },
      { sort: { createdAt: -1 } },
    );
    if (rows.length === 0) {
      return [];
    }
    const [names, options] = await Promise.all([
      loadOrgNames(
        reader,
        this.orgs,
        rows.map((row) => row.orgId),
      ),
      this.fieldOptions.options(
        operator,
        SCHEDULE_FIELD_CATEGORY_KEYS.changeReason,
      ),
    ]);
    const labels = new Map(
      options.map((option) => [option.value, option.label]),
    );
    return rows.map((row) => ({
      id: String(row._id),
      date: row.date,
      action: row.action,
      orgName: names.get(String(row.orgId)) ?? "",
      beforeStartAt: dateOrNull(row.before?.startAt),
      beforeEndAt: dateOrNull(row.before?.endAt),
      afterStartAt: dateOrNull(row.after?.startAt),
      afterEndAt: dateOrNull(row.after?.endAt),
      reason: labels.get(row.reasonKey) ?? row.reasonKey,
      reasonNote: row.reasonNote,
      createdAt: row.createdAt,
    }));
  }

  /** 登入者本人(在當前組織的租戶裡)。 */
  private async self(operator: OperatorContext): Promise<Self> {
    const org = await resolveScheduleOrg(operator, this.orgs, null);
    if (operator.actorId === null) {
      throw notFoundError("no actor");
    }
    return { org, tenantId: org.tenantId, userId: operator.actorId };
  }
}

/** 一筆排班 → 畫面(打卡紀錄取生效的那兩張;缺卡只算已結束的班)。 */
export function entryModelOf(
  entry: EntryRecord,
  context: {
    detail: EntryDetail | undefined;
    orgName: string;
    punches: readonly PunchLike[];
    now: Date;
    timezone: string;
  },
): MyScheduleEntryModel {
  const id = String(entry._id);
  const tasks = context.detail?.tasks ?? [];
  const { clockIn, clockOut } = effectivePunchesOf(id, context.punches);
  return {
    id,
    orgId: String(entry.orgId),
    orgName: context.orgName,
    date: entry.date,
    startAt: entry.startAt,
    endAt: entry.endAt,
    breakMinutes: entry.breakMinutes,
    shortName: context.detail?.shortName ?? null,
    isLead: tasks.some((task) => task.role === "leader"),
    positionKey: tasks.at(0)?.positionKey ?? null,
    tasks: tasks.map((task) => ({
      role: task.role,
      taskKey: task.taskKey,
      positionKey: task.positionKey,
    })),
    clockIn,
    clockOut,
    missing: missingPunchesOf(
      {
        id,
        date: dateKeyOf(entry.date, context.timezone),
        startAt: entry.startAt,
        endAt: entry.endAt,
      },
      context.punches,
      context.now,
    ),
  };
}
