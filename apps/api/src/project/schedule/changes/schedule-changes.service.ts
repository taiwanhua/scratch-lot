import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import type { OperatorContext } from "../../../database/operator-context";
import { NotificationService } from "../../../notifications/notification.service";
import { ScheduleChangesRepository } from "../../database/schedule/roster.repositories";
import {
  SCHEDULE_CHANGED,
  SCHEDULE_MY_SCHEDULE_REF,
} from "../../notifications";
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
    await this.recordMany(operator, scope, reason, [change]);
  }

  /**
   * 一次寫多列異動(同一個原因)並通知牽涉的人(TX-06;必須在呼叫端的交易內):異動一次 `createMany`,
   * 每列仍是一列、每位牽涉的人每列仍收到一則通知(內容與逐列 `record` 相同)。
   * 通知依「內容相同」(同一天、同一個月份連結)合併成一次 `notify`:同一組裡一個人有幾列就分幾輪,
   * 每輪每人最多一次(`dedupeKey` 是同一個人只通知一次,同一輪不能有同一人兩列)。
   * 每輪的 `dedupeKey` 取那一輪第一列的 id(第二輪起再帶輪次),只有一列時與 `record` 相同。
   */
  async recordMany(
    operator: OperatorContext,
    scope: { org: ScheduleOrg; timezone: string },
    reason: ChangeReason,
    changes: readonly ScheduleChangeRecord[],
  ): Promise<void> {
    if (changes.length === 0) {
      return;
    }
    const { org } = scope;
    const userIdsOf = changes.map((change) => [
      ...new Set(change.userIds.map(String)),
    ]);
    const rows = await this.changes.createMany(
      operator,
      changes.map((change, index) => ({
        orgId: org.id,
        month: change.month,
        date: change.date,
        action: change.action,
        targetId: change.targetId,
        userIds: (userIdsOf[index] ?? []).map((id) => new Types.ObjectId(id)),
        before: change.before,
        after: change.after,
        reasonKey: reason.reasonKey,
        reasonNote: reason.reasonNote,
      })),
    );
    const reasonText =
      reason.reasonNote === null
        ? reason.label
        : `${reason.label}(${reason.reasonNote})`;
    for (const batch of notificationRounds(changes, userIdsOf, rows, scope)) {
      await this.notifications.notify({
        type: SCHEDULE_CHANGED,
        tenantId: org.tenantId,
        orgId: org.id,
        recipients: { kind: "users", userIds: batch.userIds },
        params: { orgName: org.name, date: batch.date, reason: reasonText },
        // 點進去 = 我的班表的那個月
        ref: { type: SCHEDULE_MY_SCHEDULE_REF, id: batch.month },
        dedupeKey: batch.dedupeKey,
      });
    }
  }
}

/** 一次 `notify`:同一天、同一個月份連結,每人最多一次。 */
interface NotificationRound {
  date: string;
  month: string;
  userIds: string[];
  dedupeKey: string;
}

/** 依通知內容(那天、月份)分組,組內依同一人出現的次數分輪(TX-06「同一筆在同一批出現多次」)。 */
function notificationRounds(
  changes: readonly ScheduleChangeRecord[],
  userIdsOf: readonly string[][],
  rows: readonly { _id: Types.ObjectId }[],
  scope: { timezone: string },
): NotificationRound[] {
  const groups = new Map<
    string,
    {
      date: string;
      month: string;
      rounds: { rowId: string; users: string[] }[];
    }
  >();
  for (const [index, change] of changes.entries()) {
    const userIds = userIdsOf[index] ?? [];
    const rowId = rows[index]?._id;
    if (userIds.length === 0 || rowId === undefined) {
      continue;
    }
    const date = dateKeyOf(change.date, scope.timezone);
    const key = `${date}|${change.month}`;
    const group = groups.get(key) ?? { date, month: change.month, rounds: [] };
    groups.set(key, group);
    for (const userId of userIds) {
      const round =
        group.rounds.find((item) => !item.users.includes(userId)) ??
        (() => {
          const created = { rowId: String(rowId), users: [] as string[] };
          group.rounds.push(created);
          return created;
        })();
      round.users.push(userId);
    }
  }
  return [...groups.values()].flatMap((group) =>
    group.rounds.map((round, index) => ({
      date: group.date,
      month: group.month,
      userIds: round.users,
      dedupeKey:
        index === 0
          ? `${SCHEDULE_CHANGED}:${round.rowId}`
          : `${SCHEDULE_CHANGED}:${round.rowId}:${String(index)}`,
    })),
  );
}
