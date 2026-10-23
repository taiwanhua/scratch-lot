import { useTranslations } from "use-intl";

import {
  DAYS_BEFORE_MAX_COUNT,
  SCHEDULE_STEP_MINUTES,
} from "@repo/domain/notification-schedule";
import { NotificationScheduleKind } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { TimePicker } from "@repo/ui/time-picker";
import { Typography } from "@repo/ui/typography";

import {
  type ScheduleDraft,
  type ScheduleIssues,
} from "./notification-schedule";

export interface ScheduleEditorProps {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  /** 本地驗證或 api 標回的問題(key 同 `validateScheduleDraft`) */
  issues: ScheduleIssues;
}

/**
 * 提醒時間的編輯區(寫法由類型宣告、不能換):
 * 某日期前 N 天 = 提前天數 `[30] [7] [0] [+ 加一個]` + 時間;逾期後每天 = 時間;每月第 N 天 = 第幾天 + 時間。
 * 時間用 `TimePicker`(`HH:mm`),選單只列 15 分鐘一格;鍵盤打出不在格子上的時間由送出前的驗證擋下。
 */
export const ScheduleEditor = ({
  value,
  onChange,
  issues,
}: ScheduleEditorProps) => {
  const t = useTranslations("admin.notificationSettings.scheduleEditor");
  const tIssues = useTranslations(
    "admin.notificationSettings.scheduleEditor.issues",
  );

  const setDay = (index: number, text: string) => {
    onChange({
      ...value,
      daysBefore: value.daysBefore.map((day, at) =>
        at === index ? text : day,
      ),
    });
  };

  const daysIssue = issues.get("daysBefore");
  const dayOfMonthIssue = issues.get("dayOfMonth");
  const timeIssue = issues.get("time");

  return (
    <Stack spacing={2}>
      {value.kind === NotificationScheduleKind.DaysBefore && (
        <Stack spacing={1}>
          <Typography variant="body2" color="textSecondary">
            {t("daysBeforeHint")}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "flex-start" }}
          >
            {value.daysBefore.map((day, index) => {
              const issue = issues.get(`daysBefore[${String(index)}]`);
              return (
                // 輸入中的天數會變,只能用位置當 key(不重排、只在尾端加、任一個移除)
                <Stack
                  key={index}
                  direction="row"
                  sx={{ alignItems: "flex-start" }}
                >
                  <TextField
                    size="small"
                    label={t("daysBefore", { index: index + 1 })}
                    value={day}
                    error={issue !== undefined}
                    helperText={
                      issue === undefined ? undefined : tIssues(issue)
                    }
                    slotProps={{
                      htmlInput: { inputMode: "numeric" },
                    }}
                    sx={{ width: 150 }}
                    onChange={(event) => {
                      setDay(index, event.target.value);
                    }}
                  />
                  <IconButton
                    size="small"
                    aria-label={t("removeDay", { index: index + 1 })}
                    disabled={value.daysBefore.length <= 1}
                    sx={{ mt: 0.75 }}
                    onClick={() => {
                      onChange({
                        ...value,
                        daysBefore: value.daysBefore.filter(
                          (_, at) => at !== index,
                        ),
                      });
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              );
            })}
            <Button
              variant="text"
              size="small"
              disabled={value.daysBefore.length >= DAYS_BEFORE_MAX_COUNT}
              sx={{ mt: 0.5 }}
              onClick={() => {
                onChange({ ...value, daysBefore: [...value.daysBefore, ""] });
              }}
            >
              {t("addDay")}
            </Button>
          </Stack>
          {daysIssue !== undefined && (
            <Typography variant="body2" color="error" role="alert">
              {tIssues(daysIssue)}
            </Typography>
          )}
        </Stack>
      )}
      {value.kind === NotificationScheduleKind.DailyOverdue && (
        <Typography variant="body2" color="textSecondary">
          {t("dailyOverdueHint")}
        </Typography>
      )}
      {value.kind === NotificationScheduleKind.Monthly && (
        <TextField
          size="small"
          label={t("dayOfMonth")}
          value={value.dayOfMonth}
          error={dayOfMonthIssue !== undefined}
          helperText={
            dayOfMonthIssue === undefined
              ? t("dayOfMonthHint")
              : tIssues(dayOfMonthIssue)
          }
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          sx={{ width: { xs: "100%", sm: 400 } }}
          onChange={(event) => {
            onChange({ ...value, dayOfMonth: event.target.value });
          }}
        />
      )}
      <TimePicker
        size="small"
        label={t("time")}
        value={value.time}
        minutesStep={SCHEDULE_STEP_MINUTES}
        error={timeIssue === undefined ? undefined : true}
        helperText={
          timeIssue === undefined ? t("timeHint") : tIssues(timeIssue)
        }
        sx={{ width: { xs: "100%", sm: 400 } }}
        onChange={(time) => {
          // 清空或打到一半存空字串(草稿的 `time` 是字串),送出前的驗證會擋下
          onChange({ ...value, time: time ?? "" });
        }}
      />
    </Stack>
  );
};
