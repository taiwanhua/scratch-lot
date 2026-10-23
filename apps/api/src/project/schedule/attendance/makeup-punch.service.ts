import { Injectable } from "@nestjs/common";
import { type ClientSession, Types } from "mongoose";

import { requiresReasonNote } from "@repo/domain/project/reason-note";
import {
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
  makeupPunchValuesOf,
} from "@repo/domain/project/schedule-settings";

import { FormSubmissionsRepository } from "../../../database/base/repositories";
import { OrgsRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { tenantBoundaryContext } from "../../../database/tenant-boundary-context";
import { tenantTimezoneOf } from "../../../database/tenant-timezone";
import { FormAccessService } from "../../../forms/form-access.service";
import type { FormGuardResult } from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { SubmissionReadAccess } from "../../../workflows/workflow-engine/submission-read-access.service";
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
import { dayRangeOf } from "../shared/schedule-dates";
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
  /** 對應排班不是本人在那家店、補打卡那天有上班時間的已發布排班 */
  entryMismatch: "MAKEUP_PUNCH_ENTRY_MISMATCH",
  /** 審核中,選的那筆排班已被刪除(只能退回讓本人重選) */
  entryDeleted: "MAKEUP_PUNCH_ENTRY_DELETED",
  /** 補打卡時間 / 分店 / 類型缺或格式不對 */
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
 * - 「對應排班」**必選**:本人在那家店、補打卡那天(租戶時區)有上班時間的已發布排班(那天的班,與前一天
 *   跨午夜做到這天的班),或「沒有排班(臨時代班)」
 * - 送出時檢查(`beforeSubmit`);審核中那筆排班被刪除 → 不能核准(`beforeApprove`),只改時間照常核准
 * - 完成(`completed`)寫一張打卡:source = 補打卡、`entryId` = 申請時選的那一筆(不自動找;選「沒有排班」=
 *   未對應排班),時間 = 表單的「補打卡時間」(日期時間欄,存的就是時點)
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
    private readonly formAccess: FormAccessService,
    private readonly readAccess: SubmissionReadAccess,
  ) {}

  /**
   * 新增頁的「對應排班」下拉:本人在那家店、`at` 那天有上班時間的已發布排班(含前一天跨午夜的班;
   * 最後一個選項「沒有排班」由畫面加)。
   */
  async entryOptions(
    operator: OperatorContext,
    input: { at: Date; orgId: string },
  ): Promise<ScheduleEntryForShift[]> {
    if (!Number.isFinite(input.at.getTime())) {
      throw validationError("at must be an instant", ["at"]);
    }
    if (operator.actorId === null) {
      throw notFoundError("no actor");
    }
    const org = await resolveScheduleOrg(operator, this.orgs, input.orgId);
    return this.lookup.listEntriesOverlappingDay(operator, {
      tenantId: org.tenantId,
      userId: operator.actorId,
      orgId: org.id,
      at: input.at,
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
      parsed.punchAt === null ||
      parsed.punchType === null
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
    return entry !== null &&
      operator.actorId !== null &&
      entry.userId.equals(operator.actorId) &&
      entry.orgId.equals(branchId) &&
      entryOverlapsDayOf(entry, parsed.punchAt, timezone)
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
   * 這筆申請選的排班還在不在(審核畫面的警告「對應的排班已被刪除」;模組詳情頁與申請中心都用);
   * 選「沒有排班」= true。誰查得到 = 讀得到這筆申請的人(底座的唯一判準 `SubmissionReadAccess`):
   * 有 `schedule.attendance.view` 且照原規則讀得到(可見範圍 + 資料範圍)、申請人、這張申請流程上的審核者
   * (現在或曾持有任務)、知會對象;其他人(含同租戶)→ `NOT_FOUND`。
   * 申請以讀者的租戶為邊界讀(底座的審核流程存取,不套 `form_submissions` 的資料範圍),排班以租戶邊界反查。
   */
  async entryExistsFor(
    operator: OperatorContext,
    submissionId: string,
  ): Promise<boolean> {
    const id = toObjectId(submissionId);
    const notFound = notFoundError(`makeup punch not found: ${submissionId}`);
    if (id === null) {
      throw notFound;
    }
    const facts = await this.formAccess.factsOf(operator);
    const submission = await this.readAccess.findInTenant(facts, id);
    if (
      submission?.moduleKey !== MAKEUP_PUNCH_MODULE_KEY ||
      submission.formKey !== MAKEUP_PUNCH_FORM_KEY
    ) {
      throw notFound;
    }
    const readable = await this.readAccess.readableRevisions(facts, submission);
    if (readable.kind === "none") {
      throw notFound;
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
      parsed.punchAt === null ||
      parsed.punchType === null ||
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
    await this.punches.create(
      writer,
      {
        orgId: entry?.orgId ?? branchId,
        userId: submission.createdBy,
        at: parsed.punchAt,
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
 * 這筆排班在 `at` 那天(租戶時區)有沒有上班時間:`startAt < 隔天 00:00` 且 `endAt > 那天 00:00`
 * (那天的班,與前一天跨午夜做到這天的班;「對應排班」下拉與送出檢查同一條)。
 */
export function entryOverlapsDayOf(
  entry: { startAt: Date; endAt: Date },
  at: Date,
  timezone: string,
): boolean {
  const day = dayRangeOf(at, timezone);
  return entry.startAt.getTime() < day.to && entry.endAt.getTime() > day.from;
}
