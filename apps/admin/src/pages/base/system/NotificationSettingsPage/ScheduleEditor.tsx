import { useTranslations } from "use-intl";

import {
  DAYS_BEFORE_MAX_COUNT,
  SCHEDULE_TIME_OPTIONS,
} from "@repo/domain/notification-schedule";
import { NotificationScheduleKind } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
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

const TIME_OPTIONS = SCHEDULE_TIME_OPTIONS.map((time) => ({
  value: time,
  label: time,
}));

/**
 * 提醒時間的編輯區(寫法由類型宣告、不能換):
 * 某日期前 N 天 = 提前天數 `[30] [7] [0] [+ 加一個]` + 時間;逾期後每天 = 時間;每月第 N 天 = 第幾天 + 時間。
 * 時間只能從 15 分鐘一格的選單挑。
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

  return (
    <Stack spacing={2}>
      {value.kind === NotificationScheduleKind.DaysBefore && (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
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
            <Typography variant="body2" color="error.main" role="alert">
              {tIssues(daysIssue)}
            </Typography>
          )}
        </Stack>
      )}
      {value.kind === NotificationScheduleKind.DailyOverdue && (
        <Typography variant="body2" color="text.secondary">
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
      <SelectField
        size="small"
        label={t("time")}
        options={TIME_OPTIONS}
        value={value.time}
        helperText={t("timeHint")}
        sx={{ width: { xs: "100%", sm: 400 } }}
        onChange={(time) => {
          onChange({ ...value, time });
        }}
      />
    </Stack>
  );
};
