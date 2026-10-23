import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import { type InstantRange, startOfLocalDayOf } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  SCHEDULE_CALENDAR_DAY_TYPES,
  type ScheduleCalendarDayType,
} from "@repo/domain/project/schedule-settings";
import { isTagPaletteKey } from "@repo/domain/project/tag-palette";

import { AuditService } from "../../../audit/audit.service";
import type { Persisted } from "../../../database/base.repository";
import { OrgsRepository } from "../../../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../../../database/operator-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import {
  type ScheduleCalendarDayDocument,
  ScheduleCalendarDaysRepository,
} from "../../database/schedule/schedule.repositories";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import { dateKeyOf, instantRangeFilter } from "../shared/schedule-dates";
import {
  SCHEDULE_REASONS,
  forbiddenError,
  notFoundError,
  savingUnique,
  validationError,
} from "../shared/schedule-error";
import {
  type ScheduleOrg,
  loadOrgNames,
  parseObjectId,
  resolveScheduleOrg,
  scheduleOrgReader,
} from "../shared/schedule-org";
import {
  SCHEDULE_PERMISSIONS,
  SchedulePermissions,
} from "../shared/schedule-permissions";
import { pickEffectiveDays } from "./calendar-resolution";
import type {
  DeleteScheduleCalendarDayInput,
  SaveScheduleCalendarDayInput,
} from "./dto/schedule-calendar.input";
import type {
  ScheduleCalendarDayModel,
  ScheduleCalendarPayload,
} from "./models/schedule-calendar.model";

type DayRecord = Persisted<ScheduleCalendarDayDocument>;

const AUDIT_TARGET_TYPE = "schedule_calendar_day";

const MS_PER_HOUR = 3_600_000;
/** 一次查詢最長一個月:31 天再多一小時(夏令時間那天;同報表期間的上限算法)。 */
const MAX_RANGE_MS = 31 * 24 * MS_PER_HOUR + MS_PER_HOUR;

/** 時點區間 `[from, to)` 要迄晚於起、最長一個月;否則 `VALIDATION_FAILED`(欄位 `from`、`to`)。 */
function assertCalendarRange(from: Date, to: Date): void {
  const start = from.getTime();
  const end = to.getTime();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > MAX_RANGE_MS
  ) {
    throw validationError(
      "from / to must be instants with from < to, at most one month",
      ["from", "to"],
    );
  }
}

function isDayType(value: string): value is ScheduleCalendarDayType {
  return (SCHEDULE_CALENDAR_DAY_TYPES as readonly string[]).includes(value);
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * 行事曆(規格 14.5「行事曆」;正本 `docs/modules/project/schedule.md`「行事曆」)。
 *
 * - 讀:某家店一段期間(`[from, to)` 時點區間,最長一個月),每天以最接近的那一層為準(`calendar-resolution.ts`)
 * - 日期是時點:`date` 存那天租戶時區 00:00;寫入時以租戶時區正規化成那天 00:00
 * - 寫:要 `schedule.manage.edit-calendar`;寫在選的那家店那一層,只有那一層能改 / 刪
 *   (沿用上層的那一天在本店看得到、改不了 → `FORBIDDEN` / `NOT_OWNER`)
 * - 同一層同一天只有一筆(店休與特殊日擇一;唯一索引兜底同時寫入)
 * - 特殊日類別要是欄位管理「特殊日類別」啟用中的選項
 */
@Injectable()
export class ScheduleCalendarService {
  constructor(
    private readonly days: ScheduleCalendarDaysRepository,
    private readonly orgs: OrgsRepository,
    private readonly permissions: SchedulePermissions,
    private readonly audit: AuditService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
  ) {}

  async range(
    operator: OperatorContext,
    orgId: string | null | undefined,
    range: { from: Date; to: Date },
  ): Promise<ScheduleCalendarPayload> {
    assertCalendarRange(range.from, range.to);
    const org = await resolveScheduleOrg(operator, this.orgs, orgId);
    const records = await this.effectiveRecords(operator, org.chain, {
      $gte: range.from,
      $lt: range.to,
    });
    const canEdit = await this.canEdit(operator);
    const names = await loadOrgNames(operator, this.orgs, org.chain);
    return {
      orgId: String(org.id),
      orgName: org.name,
      from: range.from,
      to: range.to,
      canEdit,
      days: records.map((record) => dayModelOf(record, org, names, canEdit)),
    };
  }

  async save(
    operator: OperatorContext,
    input: SaveScheduleCalendarDayInput,
  ): Promise<ScheduleCalendarDayModel> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const timezone = await tenantTimezoneOf(this.orgs, operator, org.tenantId);
    const data = validatedDay(input, timezone);
    const dayText = dateKeyOf(data.date, timezone);
    const context = operator;
    const existing =
      input.id === undefined || input.id === null
        ? null
        : await this.mustOwnDay(operator, org, input.id);
    const sameDate = await this.days.findOne(context, {
      orgId: org.id,
      date: data.date,
    });
    if (sameDate && String(sameDate._id) !== String(existing?._id)) {
      throw validationError(
        `org already has a calendar day on ${dayText}`,
        ["date"],
        SCHEDULE_REASONS.calendarDayDuplicate,
      );
    }
    if (data.category !== null) {
      await this.fieldOptions.assertOptions(operator, [
        {
          categoryKey: SCHEDULE_FIELD_CATEGORY_KEYS.specialDayCategory,
          value: data.category,
          field: "category",
        },
      ]);
    }
    // 兩個請求同時新增同一天:唯一索引 `(orgId, date)` 擋下第二筆,回同一個錯誤
    const saved = await savingUnique(
      () =>
        existing
          ? this.days.updateById(context, existing._id, { $set: data })
          : this.days.create(operator, { orgId: org.id, ...data }),
      `org already has a calendar day on ${dayText}`,
      ["date"],
      SCHEDULE_REASONS.calendarDayDuplicate,
    );
    if (!saved) {
      throw notFoundError(`calendar day not found: ${String(input.id)}`);
    }
    await this.audit.record(operator, {
      action: existing
        ? "schedule-calendar-day.edit"
        : "schedule-calendar-day.create",
      targetType: AUDIT_TARGET_TYPE,
      targetId: saved._id,
      before: existing ? auditOf(existing) : undefined,
      after: auditOf(saved),
    });
    const names = await loadOrgNames(operator, this.orgs, org.chain);
    return dayModelOf(saved, org, names, true);
  }

  async remove(
    operator: OperatorContext,
    input: DeleteScheduleCalendarDayInput,
  ): Promise<string> {
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    const existing = await this.mustOwnDay(operator, org, input.id);
    await this.days.softDeleteById(operator, existing._id);
    await this.audit.record(operator, {
      action: "schedule-calendar-day.delete",
      targetType: AUDIT_TARGET_TYPE,
      targetId: existing._id,
      before: auditOf(existing),
    });
    return String(existing._id);
  }

  /**
   * 某家店一段期間(半開的時點區間 `[from, to)`)的生效行事曆;排班作業(店休擋排班、特殊日背景)共用。
   * 這家店要在操作者的可見範圍內(排程以 `tenantBoundaryContext` 呼叫 = 整個租戶),否則 `NOT_FOUND`;
   * 上層鏈建的行事曆照「上層沿用到下層」讀。
   */
  async effectiveDays(
    operator: OperatorContext,
    orgId: Types.ObjectId,
    range: InstantRange,
  ): Promise<DayRecord[]> {
    // 這家店要在操作者(或排程的租戶系統身分)的可見範圍內 —— 可見範圍本身就以租戶為界
    if (!isOrgVisible(operator, orgId)) {
      throw notFoundError(`org not found: ${String(orgId)}`);
    }
    const org = await this.orgs.findById(scheduleOrgReader(operator), orgId);
    if (!org) {
      throw notFoundError(`org not found: ${String(orgId)}`);
    }
    const chain = [org._id, ...org.ancestors.slice(1).toReversed()];
    return this.effectiveRecords(operator, chain, instantRangeFilter(range));
  }

  // ---- 內部 ----

  private async effectiveRecords(
    operator: OperatorContext,
    chain: readonly Types.ObjectId[],
    dateRange: { $gte: Date; $lt: Date },
  ): Promise<DayRecord[]> {
    const records = await this.days.findMany(operator, {
      orgId: { $in: [...chain] },
      date: dateRange,
    });
    return pickEffectiveDays(chain.map(String), records);
  }

  private async canEdit(operator: OperatorContext): Promise<boolean> {
    const holds = await this.permissions.holderOf(operator);
    return holds(SCHEDULE_PERMISSIONS.editCalendar);
  }

  /** 看得到(鏈上設的)→ 否則 `NOT_FOUND`;不是這一層設的 → `FORBIDDEN`。 */
  private async mustOwnDay(
    operator: OperatorContext,
    org: ScheduleOrg,
    id: string,
  ): Promise<DayRecord> {
    const record = await this.days.findOne(operator, {
      _id: parseObjectId(id, "id"),
      orgId: { $in: org.chain },
    });
    if (!record) {
      throw notFoundError(`calendar day not found: ${id}`);
    }
    if (String(record.orgId) !== String(org.id)) {
      throw forbiddenError(
        `calendar day ${id} is set by an upper org`,
        "NOT_OWNER",
      );
    }
    return record;
  }
}

function validatedDay(
  input: SaveScheduleCalendarDayInput,
  timezone: string,
): {
  date: Date;
  type: ScheduleCalendarDayType;
  category: string | null;
  name: string | null;
  note: string | null;
  paletteKey: string | null;
} {
  const errors: string[] = [];
  const instant = input.date.getTime();
  if (!Number.isFinite(instant)) {
    errors.push("date");
  }
  if (!isDayType(input.type)) {
    errors.push("type");
  }
  const isSpecial = input.type === "special";
  const category = isSpecial ? blankToNull(input.category) : null;
  const name = blankToNull(input.name);
  const paletteKey = isSpecial ? (input.paletteKey ?? null) : null;
  if (isSpecial && category === null) {
    errors.push("category");
  }
  if (isSpecial && name === null) {
    errors.push("name");
  }
  if (paletteKey !== null && !isTagPaletteKey(paletteKey)) {
    errors.push("paletteKey");
  }
  if (errors.length > 0) {
    throw validationError(`invalid calendar day: ${errors.join(", ")}`, errors);
  }
  return {
    // 以租戶時區正規化成那天 00:00(admin 送的就是 00:00;送了當天其他時刻也歸到同一天)
    date: new Date(startOfLocalDayOf(instant, timezone)),
    type: input.type as ScheduleCalendarDayType,
    category,
    name,
    note: blankToNull(input.note),
    paletteKey,
  };
}

function auditOf(record: DayRecord): Record<string, unknown> {
  return {
    date: record.date,
    type: record.type,
    category: record.category,
    name: record.name,
    paletteKey: record.paletteKey,
  };
}

function dayModelOf(
  record: DayRecord,
  org: ScheduleOrg,
  names: ReadonlyMap<string, string>,
  canEdit: boolean,
): ScheduleCalendarDayModel {
  const ownerId = String(record.orgId);
  return {
    id: String(record._id),
    date: record.date,
    type: record.type,
    category: record.category,
    name: record.name,
    note: record.note,
    paletteKey: record.paletteKey,
    ownerOrg: { id: ownerId, name: names.get(ownerId) ?? "" },
    canEdit: canEdit && ownerId === String(org.id),
  };
}
