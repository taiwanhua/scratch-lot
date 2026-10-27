import { dailyCloseOverdueAt } from "@repo/domain/project/lottery";

import type { EffectiveSchedule } from "../../../notifications/notification-settings.service";

/** 類型宣告的預設寄送時間(規格 3.4;`notifications.ts` 日結逾期那一筆)。 */
const DEFAULT_TIME = "09:00";

/**
 * 這家店算不算日結逾期(規格 3.4、6.10):最早一張還沒被涵蓋的交班結帳,送出日隔天的寄送時間(租戶在通知設定頁
 * 調整後的值)已經到了。**日結逾期提醒與側欄數字都經這一支判斷**,兩邊的時點一致。
 */
export function isDailyCloseOverdue(
  earliestSubmittedAt: Date,
  effective: EffectiveSchedule,
  timezone: string,
  at: Date,
): boolean {
  const time =
    effective.schedule.kind === "daily-overdue"
      ? effective.schedule.time
      : DEFAULT_TIME;
  return (
    dailyCloseOverdueAt(earliestSubmittedAt, timezone, time).getTime() <=
    at.getTime()
  );
}
