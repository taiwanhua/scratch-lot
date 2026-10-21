import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import {
  addLocalCalendar,
  instantOfLocalTime,
  localDateOf,
  localDateText,
  parseLocalDate,
} from "@repo/domain/form";
import { requiresReasonNote } from "@repo/domain/project/reason-note";
import {
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
  type MakeupPunchValues,
  makeupPunchValuesOf,
} from "@repo/domain/project/schedule-settings";

import { FormSubmissionsRepository } from "../../../database/base/repositories";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import type { FormGuardResult } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import {
  ScheduleAttendancePunchesRepository,
  ScheduleEntriesRepository,
} from "../../database/schedule/roster.repositories";
import {
  type ScheduleEntryForShift,
  ScheduleEntryLookup,
} from "../integration/entry-lookup";
import { PublishedEntries } from "../my/published-entries";
import type { EntryRecord } from "../roster/roster-people";
import { notFoundError, validationError } from "../shared/schedule-error";
import { resolveScheduleOrg } from "../shared/schedule-org";
import { SchedulePunchLedger } from "./punch-ledger";

/**
 * 補打卡申請擋下的原因(`FORBIDDEN` + `reason`;前端依它顯示文案)。
 * 掛接點的 `code` 要是大寫英數與底線。
 */
export const MAKEUP_PUNCH_REASONS = {
  /** 沒選對應排班(「請選擇對應排班」) */
  entryRequired: "MAKEUP_PUNCH_ENTRY_REQUIRED",
  /** 對應排班不是本人那天在那家店的已發布排班 */
  entryMismatch: "MAKEUP_PUNCH_ENTRY_MISMATCH",
  /** 審核中,選的那筆排班已被刪除(只能退回讓本人重選) */
  entryDeleted: "MAKEUP_PUNCH_ENTRY_DELETED",
  /** 日期 / 分店 / 類型 / 時間缺或格式不對 */
  invalidValues: "MAKEUP_PUNCH_INVALID_VALUES",
  /** 原因選「其他」沒填說明 */
  noteRequired: "MAKEUP_PUNCH_NOTE_REQUIRED",
} as const;

const block = (code: string, message: string): FormGuardResult => ({
  code,
  message,
});

const toObjectId = (id: string | null | undefined): Types.ObjectId | null =>
  typeof id === "string" && Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : null;

/**
 * 補打卡申請(規格 14.8;表單 `makeup_punch` 綁在 `schedule.attendance`;正本
 * `docs/modules/project/schedule.md`「出勤紀錄與補打卡」):
 *
 * - 「對應排班」**必選**:本人那天在那家店的已發布排班,或「沒有排班(臨時代班)」
 * - 送出時檢查(`beforeSubmit`);審核中那筆排班被刪除 → 不能核准(`beforeApprove`),只改時間照常核准
 * - 完成(`completed`)寫一張打卡:source = 補打卡、`entryId` = 申請時選的那一筆(不自動找;選「沒有排班」=
 *   未對應排班),時間 = 那天的那個時間(下班卡早於排班上班時間 = 跨午夜的班,算隔天)
 *
 * 讀寫以租戶為邊界(支援別家店的班、系統身分只看得到單據的組織)。
 */
@Injectable()
export class MakeupPunchService {
  constructor(
    private readonly orgs: OrgsRepository,
    private readonly entries: ScheduleEntriesRepository,
    private readonly punches: ScheduleAttendancePunchesRepository,
    private readonly published: PublishedEntries,
    private readonly lookup: ScheduleEntryLookup,
    private readonly submissions: FormSubmissionsRepository,
    private readonly ledger: SchedulePunchLedger,
  ) {}

  /** 新增頁的「對應排班」下拉:本人那天在那家店的已發布排班(最後一個選項「沒有排班」由畫面加)。 */
  async entryOptions(
    operator: OperatorContext,
    input: { date: string; orgId: string },
  ): Promise<ScheduleEntryForShift[]> {
    if (parseLocalDate(input.date) === null) {
      throw validationError("date must be YYYY-MM-DD", ["date"]);
    }
    if (operator.actorId === null) {
      throw notFoundError("no actor");
    }
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    return this.lookup.listEntriesOfDay(operator, {
      tenantId: org.tenantId,
      userId: operator.actorId,
      orgId: org.id,
      date: input.date,
    });
  }

  /** 我送出、還在審核中的補打卡申請對應的排班(我的班表顯示「補卡審核中」)。 */
  async pendingEntryIds(operator: OperatorContext): Promise<string[]> {
    if (operator.actorId === null) {
      return [];
    }
    const rows = await this.submissions.findMany(
      operator,
      {
        moduleKey: MAKEUP_PUNCH_MODULE_KEY,
        formKey: MAKEUP_PUNCH_FORM_KEY,
        createdBy: operator.actorId,
        status: "reviewing",
      },
      { select: "values" },
    );
    return [
      ...new Set(
        rows.flatMap((row) => {
          const { entryId } = makeupPunchValuesOf(row.values);
          return typeof entryId === "string" ? [entryId] : [];
        }),
      ),
    ];
  }

  /** 送出前(`beforeSubmit`;操作者 = 申請人)。 */
  async checkSubmit(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    values: Readonly<Record<string, unknown>>,
  ): Promise<FormGuardResult> {
    const parsed = makeupPunchValuesOf(values);
    if (parsed.entryId === undefined) {
      return block(MAKEUP_PUNCH_REASONS.entryRequired, "entry is required");
    }
    const branchId = toObjectId(parsed.branchId);
    if (
      tenantId === null ||
      branchId === null ||
      parsed.dateInstant === null ||
      parsed.punchType === null ||
      parsed.time === null
    ) {
      return block(MAKEUP_PUNCH_REASONS.invalidValues, "invalid values");
    }
    if (requiresReasonNote(parsed.reasonKey) && parsed.note === null) {
      return block(MAKEUP_PUNCH_REASONS.noteRequired, "note is required");
    }
    if (parsed.entryId === null) {
      return null;
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const timezone = await tenantTimezoneOf(this.orgs, operator, tenantId);
    const entry = await this.publishedEntry(reader, tenantId, parsed.entryId);
    const date = localDateText(
      localDateOf(parsed.dateInstant.getTime(), timezone),
    );
    return entry !== null &&
      operator.actorId !== null &&
      entry.userId.equals(operator.actorId) &&
      entry.orgId.equals(branchId) &&
      entry.date === date
      ? null
      : block(
          MAKEUP_PUNCH_REASONS.entryMismatch,
          "entry is not the applicant's entry of that day and store",
        );
  }

  /** 核准前(`beforeApprove`):選的那筆排班被刪除了 → 擋下(只能退回);只改了時間照常核准。 */
  async checkApprove(
    operator: OperatorContext,
    tenantId: Types.ObjectId | null,
    values: Readonly<Record<string, unknown>>,
  ): Promise<FormGuardResult> {
    const { entryId } = makeupPunchValuesOf(values);
    if (typeof entryId !== "string" || tenantId === null) {
      return null;
    }
    const reader = await tenantBoundaryContext(this.orgs, operator, tenantId);
    const entry = await this.entries.findOne(
      reader,
      { _id: toObjectId(entryId), tenantId },
      { select: "_id" },
    );
    return entry === null
      ? block(MAKEUP_PUNCH_REASONS.entryDeleted, "the chosen entry was deleted")
      : null;
  }

  /**
   * 這筆申請選的排班還在不在(審核頁的警告「對應的排班已被刪除」);選「沒有排班」= true。
   * 讀得到申請的人(申請人、審核者)才查得到;讀不到申請 → `NOT_FOUND`。
   */
  async entryExistsFor(
    operator: OperatorContext,
    submissionId: string,
  ): Promise<boolean> {
    const id = toObjectId(submissionId);
    const submission =
      id === null
        ? null
        : await this.submissions.findOne(operator, {
            _id: id,
            moduleKey: MAKEUP_PUNCH_MODULE_KEY,
            formKey: MAKEUP_PUNCH_FORM_KEY,
          });
    if (!submission) {
      throw notFoundError(`makeup punch not found: ${submissionId}`);
    }
    const result = await this.checkApprove(
      operator,
      submission.tenantId,
      submission.values,
    );
    return result === null;
  }

  /** 完成(`completed`;系統身分、在動作的交易內):寫一張補打卡。重送不重複寫。 */
  async complete(
    submissionId: Types.ObjectId,
    tenantId: Types.ObjectId | null,
    session: ClientSession,
  ): Promise<void> {
    if (tenantId === null) {
      throw new Error(`補打卡申請 ${String(submissionId)} 沒有租戶`);
    }
    const writer = await tenantBoundaryContext(this.orgs, null, tenantId);
    const existing = await this.punches.findOne(
      writer,
      { tenantId, makeupRequestId: submissionId },
      { select: "_id", session },
    );
    if (existing) {
      return;
    }
    const submission = await this.submissions.findById(writer, submissionId, {
      session,
    });
    if (!submission?.createdBy) {
      throw new Error(`補打卡申請 ${String(submissionId)} 讀不到申請人`);
    }
    const parsed = makeupPunchValuesOf(submission.values);
    const branchId = toObjectId(parsed.branchId);
    if (
      branchId === null ||
      parsed.dateInstant === null ||
      parsed.punchType === null ||
      parsed.time === null ||
      parsed.entryId === undefined
    ) {
      throw new Error(`補打卡申請 ${String(submissionId)} 的欄位不完整`);
    }
    const entry =
      parsed.entryId === null
        ? null
        : await this.entries.findOne(
            writer,
            { _id: toObjectId(parsed.entryId), tenantId },
            { session },
          );
    if (parsed.entryId !== null && entry === null) {
      // 核准前已擋(beforeApprove);走到這裡 = 同時被刪
      throw new Error(`補打卡申請 ${String(submissionId)} 的對應排班已被刪除`);
    }
    const timezone = await tenantTimezoneOf(this.orgs, writer, tenantId);
    const at = punchInstantOf(parsed, timezone, entry);
    await this.punches.create(
      writer,
      {
        orgId: entry?.orgId ?? branchId,
        userId: submission.createdBy,
        at,
        type: parsed.punchType,
        entryId: entry?._id ?? null,
        ip: null,
        userAgent: null,
        source: "makeup",
        makeupRequestId: submissionId,
        duplicate: false,
      },
      { session },
    );
    if (entry !== null) {
      await this.ledger.markDuplicates(writer, tenantId, entry._id);
    }
  }

  private async publishedEntry(
    reader: OperatorContext,
    tenantId: Types.ObjectId,
    entryId: string,
  ): Promise<EntryRecord | null> {
    const id = toObjectId(entryId);
    if (id === null) {
      return null;
    }
    const entry = await this.entries.findOne(reader, { _id: id, tenantId });
    if (entry === null) {
      return null;
    }
    const [published] = await this.published.publishedOnly(reader, tenantId, [
      entry,
    ]);
    return published ?? null;
  }
}

/**
 * 補打卡的時點:那天(租戶時區)的那個時間;下班卡早於對應排班的上班時點 = 跨午夜的班,算隔天。
 */
export function punchInstantOf(
  values: Pick<MakeupPunchValues, "dateInstant" | "time" | "punchType">,
  timezone: string,
  entry: { startAt: Date } | null,
): Date {
  if (values.dateInstant === null || values.time === null) {
    throw new Error("補打卡缺日期或時間");
  }
  const day = localDateOf(values.dateInstant.getTime(), timezone);
  const [hour = 0, minute = 0] = values.time.split(":").map(Number);
  const at = instantOfLocalTime(day, hour, minute, timezone);
  if (
    entry !== null &&
    values.punchType === "out" &&
    at < entry.startAt.getTime()
  ) {
    return new Date(addLocalCalendar(at, 1, "days", timezone));
  }
  return new Date(at);
}
