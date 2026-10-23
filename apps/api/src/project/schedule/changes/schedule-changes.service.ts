import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type { OperatorContext } from "../../../database/operator-context";
import { NotificationService } from "../../../notifications/notification.service";
import { ScheduleChangesRepository } from "../../database/schedule/roster.repositories";
import { SCHEDULE_CHANGED } from "../../notifications";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import { dateKeyOf } from "../shared/schedule-dates";
import { SCHEDULE_REASONS, validationError } from "../shared/schedule-error";
import type { ScheduleOrg } from "../shared/schedule-org";

/** 送來的異動原因(未發布的月份不用給)。 */
export interface ChangeReasonInputLike {
  reasonKey?: string | null;
  reasonNote?: string | null;
}

/** 驗過的異動原因:`label` = 選項的顯示名稱(通知內文用)。 */
export interface ChangeReason {
  reasonKey: string;
  reasonNote: string | null;
  label: string;
}

/** 一筆要記下的異動:`month` = 月份鍵 `YYYY-MM`;`date` = 異動那天(租戶時區 00:00 的時點)。 */
export interface ScheduleChangeRecord {
  month: string;
  date: Date;
  action: string;
  targetId: Types.ObjectId;
  userIds: readonly (Types.ObjectId | string)[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/**
 * 發布後的排班異動(規格 14.5「已發布後,兩種對話框都多一個異動原因」、14.1 `schedule_changes`、3.4 排班異動):
 *
 * - 已發布的月份:新增 / 修改 / 刪除人力需求或排班都要給異動原因(欄位管理「排班異動原因」啟用中的選項;
 *   選「其他」說明必填)。沒給 → `VALIDATION_FAILED`(欄位 `reasonKey` / `reasonNote`)
 * - 每筆異動寫一列 `schedule_changes`,並通知異動牽涉的人(`schedule.changed`);在呼叫端的交易內,
 *   寫入失敗整個回復(通知與異動同生共死)
 */
@Injectable()
export class ScheduleChangesService {
  constructor(
    private readonly changes: ScheduleChangesRepository,
    private readonly fieldOptions: ScheduleFieldOptionsService,
    private readonly notifications: NotificationService,
  ) {}

  async validatedReason(
    operator: OperatorContext,
    input: ChangeReasonInputLike | null | undefined,
  ): Promise<ChangeReason> {
    const reasonKey = blankToNull(input?.reasonKey);
    const reasonNote = blankToNull(input?.reasonNote);
    if (reasonKey === null) {
      throw validationError("a change reason is required after publishing", [
        "reasonKey",
      ]);
    }
    const options = await this.fieldOptions.options(
      operator,
      SCHEDULE_FIELD_CATEGORY_KEYS.changeReason,
    );
    const option = options.find((item) => item.value === reasonKey);
    if (option === undefined) {
      throw validationError(
        `not an enabled option: ${reasonKey}`,
        ["reasonKey"],
        SCHEDULE_REASONS.optionDisabled,
      );
    }
    if (requiresReasonNote(reasonKey) && reasonNote === null) {
      throw validationError("reasonNote is required for other", ["reasonNote"]);
    }
    return { reasonKey, reasonNote, label: option.label };
  }

  /** 寫一列異動並通知牽涉的人(每列各自 `dedupeKey`;通知的日期以租戶時區寫成 `YYYY-MM-DD`)。 */
  async record(
    operator: OperatorContext,
    scope: { org: ScheduleOrg; timezone: string },
    reason: ChangeReason,
    change: ScheduleChangeRecord,
  ): Promise<void> {
    const { org } = scope;
    const userIds = [...new Set(change.userIds.map(String))];
    const row = await this.changes.create(operator, {
      orgId: org.id,
      month: change.month,
      date: change.date,
      action: change.action,
      targetId: change.targetId,
      userIds: userIds.map((id) => new Types.ObjectId(id)),
      before: change.before,
      after: change.after,
      reasonKey: reason.reasonKey,
      reasonNote: reason.reasonNote,
    });
    if (userIds.length === 0) {
      return;
    }
    await this.notifications.notify({
      type: SCHEDULE_CHANGED,
      tenantId: org.tenantId,
      orgId: org.id,
      recipients: { kind: "users", userIds },
      params: {
        orgName: org.name,
        date: dateKeyOf(change.date, scope.timezone),
        reason:
          reason.reasonNote === null
            ? reason.label
            : `${reason.label}(${reason.reasonNote})`,
      },
      dedupeKey: `${SCHEDULE_CHANGED}:${String(row._id)}`,
    });
  }
}
