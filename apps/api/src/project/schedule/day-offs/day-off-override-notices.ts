import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";

import { UsersRepository } from "../../../database/database.module";
import type { OperatorContext } from "../../../database/operator-context";
import { NotificationService } from "../../../notifications/notification.service";
import { SCHEDULE_DAY_OFF_OVERRIDDEN } from "../../notifications";
import { ScheduleFieldOptionsService } from "../field-options/schedule-field-options.service";
import { clockTextOf } from "../shared/schedule-dates";
import type { ScheduleOrg } from "../shared/schedule-org";
import { NAMES_READER } from "../shared/schedule-readers";

/** 一次代改(一次送出 / 一筆刪除)要通知的內容。 */
export interface DayOffOverrideNotice {
  action: "add" | "delete";
  /** 總覽選的那家店(代改發生的地方) */
  org: ScheduleOrg;
  timezone: string;
  /** 被代改的員工 */
  userId: Types.ObjectId;
  /** 那天的日期鍵 `YYYY-MM-DD` */
  localDate: string;
  kind: string;
  /** 時段不可排的幾段(整天畫休為空) */
  slots: readonly { startAt: Date | null; endAt: Date | null }[];
  reason: string | null;
  reasonNote: string | null;
  /** 防重複的依據:新增 = 這次寫入的第一筆畫休 id;刪除 = 刪掉的那筆 */
  dayOffId: Types.ObjectId;
}

/**
 * 代改畫休通知員工本人(`schedule.day-off-overridden`;`docs/modules/project/schedule.md`「代改」):
 * 一次送出 = 一則(列出這次所有段落 / 整天畫休)、刪除一筆 = 一則;代改人就是本人時不送。
 * 在呼叫端的交易內呼叫(同 `schedule.changed`:寫入失敗整個回復;交易後的站內 / email 送出盡力而為,
 * 失敗只記 log,不影響儲存)。
 */
@Injectable()
export class DayOffOverrideNotices {
  constructor(
    private readonly notifications: NotificationService,
    private readonly fieldOptions: ScheduleFieldOptionsService,
    private readonly users: UsersRepository,
  ) {}

  async notify(
    operator: OperatorContext,
    notice: DayOffOverrideNotice,
  ): Promise<void> {
    if (
      operator.actorId === null ||
      String(operator.actorId) === String(notice.userId)
    ) {
      return;
    }
    const actor = await this.users.findById(NAMES_READER, operator.actorId);
    const byName = actor?.name ?? "";
    const prefix =
      notice.action === "delete"
        ? `${SCHEDULE_DAY_OFF_OVERRIDDEN}:delete`
        : SCHEDULE_DAY_OFF_OVERRIDDEN;
    await this.notifications.notify({
      type: SCHEDULE_DAY_OFF_OVERRIDDEN,
      tenantId: notice.org.tenantId,
      orgId: notice.org.id,
      recipients: { kind: "users", userIds: [notice.userId] },
      params: {
        action: notice.action,
        orgName: notice.org.name,
        date: notice.localDate,
        kind: notice.kind,
        // 依開始時間列(送出的順序不一定是時間順序)
        slots: notice.slots
          .flatMap((slot) =>
            slot.startAt === null || slot.endAt === null
              ? []
              : [{ startAt: slot.startAt, endAt: slot.endAt }],
          )
          .toSorted(
            (left, right) => left.startAt.getTime() - right.startAt.getTime(),
          )
          .map(
            (slot) =>
              `${clockTextOf(slot.startAt, notice.timezone)}–${clockTextOf(slot.endAt, notice.timezone)}`,
          )
          .join(","),
        byName,
        reason: await this.reasonText(operator, notice),
      },
      dedupeKey: `${prefix}:${String(notice.dayOffId)}`,
    });
  }

  /** 原因的顯示名稱(欄位管理「代改畫休原因」;有說明時接在括號裡,同 `schedule.changed`);沒給 → null。 */
  private async reasonText(
    operator: OperatorContext,
    notice: DayOffOverrideNotice,
  ): Promise<string | null> {
    if (notice.reason === null) {
      return null;
    }
    const options = await this.fieldOptions.options(
      operator,
      SCHEDULE_FIELD_CATEGORY_KEYS.dayOffOverrideReason,
    );
    const label =
      options.find((option) => option.value === notice.reason)?.label ??
      notice.reason;
    return notice.reasonNote === null
      ? label
      : `${label}(${notice.reasonNote})`;
  }
}
