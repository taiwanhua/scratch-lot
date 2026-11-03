import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";

import type { RescanReminder } from "./rescan-model";
import type { RescanTarget } from "./useRescanStart";
import { useRescanText } from "./useRescanText";

export interface RescanReminderAlertsProps {
  reminders: readonly RescanReminder[];
  /** [全店重刷 遊戲 X];沒有權限 = null */
  onStart: ((target: RescanTarget) => void) | null;
}

/**
 * 全店重刷提醒(8.3;看板、盤點頁的待查清單上方):「遊戲 X 有 1 張待查還沒確認是哪張,請把全店(各收銀台和庫存)的
 * 遊戲 X 都刷一次」[全店重刷 遊戲 X];只有標記異常的遊戲寫「盤點多出 N 張(標記異常)」。
 */
export const RescanReminderAlerts = ({
  reminders,
  onStart,
}: RescanReminderAlertsProps) => {
  const { t, gameOf } = useRescanText();
  return (
    <>
      {reminders.map((reminder) => (
        <Alert
          key={reminder.gameId}
          severity="warning"
          action={
            onStart === null ? undefined : (
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  onStart(reminder);
                }}
              >
                {t("reminder.start", { code: reminder.gameCode })}
              </Button>
            )
          }
        >
          {reminder.investigateCount > 0
            ? t("reminder.investigate", {
                game: gameOf(reminder),
                count: reminder.investigateCount,
                code: reminder.gameCode,
              })
            : t("reminder.flagged", {
                game: gameOf(reminder),
                count: reminder.flaggedCount,
                code: reminder.gameCode,
              })}
        </Alert>
      ))}
    </>
  );
};
