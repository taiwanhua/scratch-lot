import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  daysInLocalMonth,
  parseLocalMonth,
} from "@repo/domain/form";
import {
  type AddMyScheduleDayOffsMutation,
  type ScheduleDayOffFieldsFragment,
  useAddMyScheduleDayOffsMutation,
  useDeleteMyScheduleDayOffMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { DayOffBlockedAlert } from "@/components/project/schedule/DayOffs/DayOffBlockedAlert";
import { DayOffKindRadios } from "@/components/project/schedule/DayOffs/DayOffKindRadios";
import { DayOffSlotFields } from "@/components/project/schedule/DayOffs/DayOffSlotFields";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useDayOffDateTitle } from "@/hooks/project/schedule/useDayOffDateTitle/useDayOffDateTitle";
import { useDayOffEntryConflictNotice } from "@/hooks/project/schedule/useDayOffEntryConflictNotice/useDayOffEntryConflictNotice";
import type { FieldErrorTexts } from "@/lib/base/field-errors";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";
import {
  type DayOffKind,
  type DayOffSlot,
  EMPTY_SLOT,
  completeSlots,
  dayKeyOf,
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

/** codegen 的 query key 第一段是 operation 名稱(`useMyScheduleDayOffsQuery.getKey`)。 */
const MY_DAY_OFFS_QUERY_KEY = "MyScheduleDayOffs";

/** 會標回對話框的欄位(api `fields`)。 */
const FIELDS = ["date", "kind", "slots"] as const;
type Field = (typeof FIELDS)[number];

export interface DayOffDialogProps {
  /** 帶入的日期鍵 `YYYY-MM-DD`(點日期);[登記畫休] 為空字串 */
  initialDate: string;
  /** 開放中的目標月 `YYYY-MM`(日期只能選這個月) */
  month: string;
  /** 我這個月的畫休(列出那天已登記的,可以刪除) */
  myDayOffs: readonly ScheduleDayOffFieldsFragment[];
  onClose: () => void;
}

/**
 * 登記畫休(SC-41a 整天畫休 / SC-41b 時段不可排;規格 14.6):選了時段不可排才出現開始 / 結束
 * (一天可以多段 [+ 再加一段]);那天已登記的列在上方可以刪除。不需核准,違反限制不存、提示原因。
 * 手機全螢幕。
 */
export const DayOffDialog = ({
  initialDate,
  month,
  myDayOffs,
  onClose,
}: DayOffDialogProps) => {
  const t = useTranslations("admin.schedule.dayOffs");
  const tCommon = useTranslations("admin.schedule.common");
  const tSchedule = useTranslations("admin.schedule");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const dateTitle = useDayOffDateTitle();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const clockOf = (value: string | null | undefined) =>
    value === null || value === undefined
      ? ""
      : localPartsOf(value, timezone).time;
  const parsedMonth = parseLocalMonth(month);
  const monthBounds =
    parsedMonth === null
      ? {}
      : {
          minDate: `${month}-01`,
          maxDate: `${month}-${String(daysInLocalMonth(parsedMonth))}`,
        };
  const [date, setDate] = useState(initialDate);
  const [kind, setKind] = useState<DayOffKind>("full-day");
  const [slots, setSlots] = useState<DayOffSlot[]>([EMPTY_SLOT]);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<Field>>({});
  const setInvalid = (field: Field | null) => {
    setFieldErrors(
      field === null ? {} : scheduleFormatErrorsOf([field], tSchedule),
    );
  };
  const [blocked, setBlocked] = useState<ScheduleDayOffViolationError[]>([]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [MY_DAY_OFFS_QUERY_KEY] });
  };
  const errorOf = (error: unknown) =>
    scheduleErrorTextsOf(error, FIELDS, tSchedule).summary;
  const noticeEntryConflicts = useDayOffEntryConflictNotice();
  const save = useAddMyScheduleDayOffsMutation(
    session.client,
    useMutationFeedback<AddMyScheduleDayOffsMutation>({
      success: (data) =>
        data.addMyScheduleDayOffs.violations.length > 0
          ? t("dialog.savedWithReminders")
          : t("dialog.saveSuccess"),
      error: errorOf,
      onSuccess: (data) => {
        refresh();
        noticeEntryConflicts(data.addMyScheduleDayOffs.entryConflicts);
        onClose();
      },
      onError: (error) => {
        setBlocked(dayOffViolationsOf(error));
        setFieldErrors(scheduleErrorTextsOf(error, FIELDS, tSchedule).texts);
      },
    }),
  );
  const remove = useDeleteMyScheduleDayOffMutation(
    session.client,
    useMutationFeedback({
      success: t("dialog.deleteSuccess"),
      error: errorOf,
      onSuccess: refresh,
    }),
  );

  const existing = myDayOffs.filter(
    (item) => dayKeyOf(item.date, timezone) === date,
  );

  // 幾段合起來是整天:欄位下提示改選整天畫休、停用儲存(api 同一條規則)
  const wholeDay =
    kind === "time-range" && slotsCoverWholeDay(slots, date, timezone);

  const submit = () => {
    if (date === "") {
      setInvalid("date");
      return;
    }
    const picked = completeSlots(slots);
    if (kind === "time-range" && picked === null) {
      setInvalid("slots");
      return;
    }
    // 日期與時段以租戶時區換成時點(api 只收時點)
    const day = localDayInstantOf(date, timezone);
    const spans =
      picked === null ? null : slotInstantsOf(date, picked, timezone);
    if (day === null) {
      setInvalid("date");
      return;
    }
    setBlocked([]);
    save.mutate({
      input: {
        date: day,
        kind,
        ...(kind === "time-range" && spans !== null ? { slots: spans } : {}),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={
        date === ""
          ? t("dialog.titleNoDate")
          : t("dialog.title", { date: dateTitle(date) })
      }
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
        <DatePicker
          label={t("dialog.date")}
          value={date === "" ? null : date}
          required
          fullWidth
          error={fieldErrors.date !== undefined}
          helperText={fieldErrors.date}
          {...monthBounds}
          onChange={(next) => {
            setDate(next ?? "");
            setInvalid(null);
            setBlocked([]);
          }}
        />
        <DayOffKindRadios
          value={kind}
          errorText={fieldErrors.kind}
          onChange={(next) => {
            setKind(next);
            setInvalid(null);
          }}
        />
        {existing.map((item) => (
          <Stack
            key={item.id}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <Typography variant="body2" sx={{ flex: 1 }}>
              {item.kind === "full-day"
                ? t("dialog.registeredFullDay")
                : t("dialog.registeredTimeRange", {
                    start: clockOf(item.startAt),
                    end: clockOf(item.endAt),
                  })}
            </Typography>
            <Button
              variant="text"
              color="error"
              size="small"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ input: { id: item.id } });
              }}
            >
              {t("dialog.delete")}
            </Button>
          </Stack>
        ))}
        {kind === "time-range" && (
          <DayOffSlotFields
            slots={slots}
            wholeDay={wholeDay}
            invalid={fieldErrors.slots !== undefined}
            errorText={fieldErrors.slots}
            onChange={(next) => {
              setSlots(next);
              setInvalid(null);
            }}
            allowMultiple
          />
        )}
        <DayOffBlockedAlert violations={blocked} />
      </Stack>
    </Dialog>
  );
};
