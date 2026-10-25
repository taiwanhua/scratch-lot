import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type AddScheduleDayOffsOnBehalfMutation,
  type ScheduleDayOffDayFieldsFragment,
  useAddScheduleDayOffsOnBehalfMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { DayOffBlockedAlert } from "@/components/project/schedule/DayOffs/DayOffBlockedAlert";
import { DayOffKindRadios } from "@/components/project/schedule/DayOffs/DayOffKindRadios";
import { DayOffSlotFields } from "@/components/project/schedule/DayOffs/DayOffSlotFields";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useDayOffEntryConflictNotice } from "@/hooks/project/schedule/useDayOffEntryConflictNotice/useDayOffEntryConflictNotice";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import type { FieldErrorTexts } from "@/lib/base/field-errors";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";
import {
  type DayOffKind,
  type DayOffSlot,
  EMPTY_SLOT,
  completeSlots,
  dayKeyOf,
  registeredSlotsOf,
  slotInstantsOf,
  slotsCoverWholeDay,
} from "@/lib/project/schedule-day-offs";
import { localPartsOf } from "@/lib/project/schedule-roster";

import {
  type ScheduleDayOffViolationError,
  dayOffViolationsOf,
} from "../../schedule-error";
import {
  scheduleErrorTextsOf,
  scheduleFormatErrorsOf,
} from "../../schedule-field-errors";

/** codegen 的 query key 第一段是 operation 名稱(`useScheduleDayOffOverviewQuery.getKey`)。 */
const OVERVIEW_QUERY_KEY = "ScheduleDayOffOverview";
/** 會標回對話框的欄位(api `fields`)。 */
const FIELD_LIST = [
  "userId",
  "date",
  "kind",
  "slots",
  "reason",
  "reasonNote",
] as const;

type Field = (typeof FIELD_LIST)[number];

export interface OverrideDayOffDialogProps {
  /** 總覽選的分店(代改的對象要是這家店的排班人員) */
  orgId: string;
  staff: readonly { userId: string; name: string }[];
  /** 總覽這個月每天的畫休(選好人與日期後列出那人那天已登記的時段不可排、一起判斷是不是整天) */
  days: readonly ScheduleDayOffDayFieldsFragment[];
  /** 帶入的日期鍵 `YYYY-MM-DD`(點日期);[代改] 為空字串 */
  initialDate: string;
  /** 這個月的開放期間已截止:原因必填(api 依那個人的主要分店再判斷一次) */
  reasonRequired: boolean;
  onClose: () => void;
}

/**
 * 代改畫休(SC-24;規格 14.5,`edit-day-offs`):先選人、日期(兩者都選好後上方唯讀列出那人那天已登記的
 * 時段不可排;總覽沒有那天的資料就不顯示),再選種類(整天畫休 / 時段不可排 + 時間,一次可以多段);
 * 截止後必填原因(欄位管理「代改畫休原因」,選「其他」要填說明);寫入代改人。
 * 只做新增;刪除在畫休總覽點日期的「當天畫休」裡(`DeleteDayOffDialog`)。手機全螢幕。
 */
export const OverrideDayOffDialog = ({
  orgId,
  staff,
  days,
  initialDate,
  reasonRequired,
  onClose,
}: OverrideDayOffDialogProps) => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCommon = useTranslations("admin.schedule.common");
  const tSchedule = useTranslations("admin.schedule");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.dayOffOverrideReason,
  );
  const [userId, setUserId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [kind, setKind] = useState<DayOffKind>("full-day");
  const [slots, setSlots] = useState<DayOffSlot[]>([EMPTY_SLOT]);
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  // 欄位錯了就在欄位正下方寫原因(REACT-18);提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<Field>>({});
  const invalid = Object.keys(fieldErrors);
  const [blocked, setBlocked] = useState<ScheduleDayOffViolationError[]>([]);

  const noticeEntryConflicts = useDayOffEntryConflictNotice();
  const save = useAddScheduleDayOffsOnBehalfMutation(
    session.client,
    useMutationFeedback<AddScheduleDayOffsOnBehalfMutation>({
      success: t("override.saveSuccess"),
      error: (error: unknown) =>
        scheduleErrorTextsOf(error, FIELD_LIST, tSchedule).summary,
      onSuccess: (data) => {
        void queryClient.invalidateQueries({ queryKey: [OVERVIEW_QUERY_KEY] });
        noticeEntryConflicts(data.addScheduleDayOffsOnBehalf.entryConflicts);
        onClose();
      },
      onError: (error: unknown) => {
        setBlocked(dayOffViolationsOf(error));
        setFieldErrors(
          scheduleErrorTextsOf(error, FIELD_LIST, tSchedule).texts,
        );
      },
    }),
  );

  const reasonInput = {
    reason: reason === "" ? null : reason,
    reasonNote: reasonNote.trim() === "" ? null : reasonNote.trim(),
  };

  /** 送出前的檢查(api 會再檢查一次):人、日期、時段、原因與「其他」的說明。 */
  const missingFields = (): Field[] => {
    const missing: Field[] = [];
    if (userId === "") missing.push("userId");
    if (date === "") missing.push("date");
    if (kind === "time-range" && completeSlots(slots) === null) {
      missing.push("slots");
    }
    if (reasonRequired && reason === "") missing.push("reason");
    if (reason === REASON_OTHER_VALUE && reasonInput.reasonNote === null) {
      missing.push("reasonNote");
    }
    return missing;
  };

  // 那人那天已登記的時段不可排(總覽這個月的資料;換人或換日期就重算)
  const registered =
    userId === "" || date === ""
      ? []
      : registeredSlotsOf(
          days
            .filter((day) => dayKeyOf(day.date, timezone) === date)
            .flatMap((day) => day.dayOffs)
            .filter((item) => item.userId === userId),
        );
  const clockOf = (value: string) => localPartsOf(value, timezone).time;

  // 這次的幾段連同已登記的合起來是整天:欄位下提示改選整天畫休、停用儲存(api 同一條規則)
  const wholeDay =
    kind === "time-range" &&
    slotsCoverWholeDay(slots, date, timezone, registered);

  const submit = () => {
    const missing = missingFields();
    setFieldErrors(scheduleFormatErrorsOf(missing, tSchedule));
    setBlocked([]);
    if (missing.length > 0) {
      return;
    }
    // 日期與時段以租戶時區換成時點(api 只收時點)
    const day = localDayInstantOf(date, timezone);
    const picked = completeSlots(slots);
    const spans =
      picked === null ? null : slotInstantsOf(date, picked, timezone);
    if (day === null) {
      return;
    }
    save.mutate({
      input: {
        orgId,
        userId,
        date: day,
        kind,
        ...(kind === "time-range" && spans !== null ? { slots: spans } : {}),
        ...reasonInput,
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("override.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button disabled={save.isPending || wholeDay} onClick={submit}>
            {tCommon("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <SelectField
            label={t("override.person")}
            value={userId}
            required
            fullWidth
            error={invalid.includes("userId")}
            helperText={fieldErrors.userId}
            options={staff.map((item) => ({
              value: item.userId,
              label: item.name,
            }))}
            onChange={(next) => {
              setUserId(next);
              setFieldErrors({});
            }}
          />
          <DatePicker
            label={t("dialog.date")}
            value={date === "" ? null : date}
            required
            fullWidth
            error={invalid.includes("date")}
            helperText={fieldErrors.date}
            onChange={(next) => {
              setDate(next ?? "");
              setFieldErrors({});
            }}
          />
        </Stack>
        {registered.length > 0 && (
          <Stack spacing={0.5} aria-label={t("override.registered")}>
            <Typography variant="subtitle2">
              {t("override.registered")}
            </Typography>
            {registered.map((slot) => (
              <Typography key={slot.startAt} variant="body2">
                {t("dialog.registeredTimeRange", {
                  start: clockOf(slot.startAt),
                  end: clockOf(slot.endAt),
                })}
              </Typography>
            ))}
          </Stack>
        )}
        <Typography variant="subtitle2">{t("override.kind")}</Typography>
        <DayOffKindRadios
          value={kind}
          errorText={fieldErrors.kind}
          onChange={setKind}
        />
        {kind === "time-range" && (
          <DayOffSlotFields
            slots={slots}
            wholeDay={wholeDay}
            invalid={invalid.includes("slots")}
            errorText={fieldErrors.slots}
            onChange={(next) => {
              setSlots(next);
              setFieldErrors({});
            }}
            allowMultiple
          />
        )}
        <SelectField
          label={t("override.reason")}
          value={reason}
          required={reasonRequired}
          fullWidth
          error={invalid.includes("reason")}
          helperText={fieldErrors.reason}
          options={reasons.options}
          onChange={(next) => {
            setReason(next);
            setFieldErrors({});
          }}
        />
        {reason === REASON_OTHER_VALUE && (
          <TextField
            label={t("override.reasonNote")}
            value={reasonNote}
            required
            fullWidth
            error={invalid.includes("reasonNote")}
            helperText={fieldErrors.reasonNote}
            onChange={(event) => {
              setReasonNote(event.target.value);
              setFieldErrors({});
            }}
          />
        )}
        <Typography variant="caption" color="textSecondary">
          {t("override.reasonHint")}
        </Typography>
        <DayOffBlockedAlert violations={blocked} />
      </Stack>
    </Dialog>
  );
};
