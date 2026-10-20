import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type AddScheduleDayOffsOnBehalfMutation,
  type ScheduleDayOffDayFieldsFragment,
  useAddScheduleDayOffsOnBehalfMutation,
  useDeleteScheduleDayOffOnBehalfMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
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
import { useDayOffEntryConflictNotice } from "@/hooks/project/schedule/useDayOffEntryConflictNotice/useDayOffEntryConflictNotice";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import {
  type DayOffKind,
  type DayOffSlot,
  EMPTY_SLOT,
  completeSlots,
} from "@/lib/project/schedule-day-offs";

import {
  type ScheduleDayOffViolationError,
  dayOffViolationsOf,
  scheduleErrorOf,
} from "../../schedule-error";

/** codegen 的 query key 第一段是 operation 名稱(`useScheduleDayOffOverviewQuery.getKey`)。 */
const OVERVIEW_QUERY_KEY = "ScheduleDayOffOverview";
type Field = "userId" | "date" | "slots" | "reason" | "reasonNote";

export interface OverrideDayOffDialogProps {
  /** 總覽選的分店(代改的對象要是這家店的排班人員) */
  orgId: string;
  staff: readonly { userId: string; name: string }[];
  /** 總覽這個月的畫休(列出選的人那天已登記的,可以刪除) */
  days: readonly ScheduleDayOffDayFieldsFragment[];
  /** 帶入的日期(點日期);[代改] 為空字串 */
  initialDate: string;
  /** 這個月的開放期間已截止:原因必填(api 依那個人的主要分店再判斷一次) */
  reasonRequired: boolean;
  onClose: () => void;
}

/**
 * 代改畫休(SC-24;規格 14.5,`edit-day-offs`):選人、日期、種類(整天畫休 / 時段不可排 + 時間);
 * 截止後必填原因(欄位管理「代改畫休原因」,選「其他」要填說明);寫入代改人。
 * 那個人那天已登記的列在上方,可以刪除(原因規則相同)。手機全螢幕。
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
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.dayOffOverrideReason,
  );
  const [userId, setUserId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [kind, setKind] = useState<DayOffKind>("full-day");
  const [slots, setSlots] = useState<DayOffSlot[]>([EMPTY_SLOT]);
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [blocked, setBlocked] = useState<ScheduleDayOffViolationError[]>([]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [OVERVIEW_QUERY_KEY] });
  };
  const errorOf = (error: unknown) => tErrors(scheduleErrorOf(error).code);
  const onError = (error: unknown) => {
    setBlocked(dayOffViolationsOf(error));
    setInvalid((scheduleErrorOf(error).fields ?? []) as Field[]);
  };
  const noticeEntryConflicts = useDayOffEntryConflictNotice();
  const save = useAddScheduleDayOffsOnBehalfMutation(
    session.client,
    useMutationFeedback<AddScheduleDayOffsOnBehalfMutation>({
      success: t("override.saveSuccess"),
      error: errorOf,
      onSuccess: (data) => {
        refresh();
        noticeEntryConflicts(data.addScheduleDayOffsOnBehalf.entryConflicts);
        onClose();
      },
      onError,
    }),
  );
  const remove = useDeleteScheduleDayOffOnBehalfMutation(
    session.client,
    useMutationFeedback({
      success: t("override.deleteSuccess"),
      error: errorOf,
      onSuccess: refresh,
      onError,
    }),
  );

  const existing =
    userId === ""
      ? []
      : (days.find((day) => day.date === date)?.dayOffs ?? []).filter(
          (item) => item.userId === userId,
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

  const submit = () => {
    const missing = missingFields();
    setInvalid(missing);
    setBlocked([]);
    if (missing.length > 0) {
      return;
    }
    const picked = completeSlots(slots);
    save.mutate({
      input: {
        orgId,
        userId,
        date,
        kind,
        ...(kind === "time-range" && picked !== null ? { slots: picked } : {}),
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
          <Button disabled={save.isPending} onClick={submit}>
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
            options={staff.map((item) => ({
              value: item.userId,
              label: item.name,
            }))}
            onChange={(next) => {
              setUserId(next);
              setInvalid([]);
            }}
          />
          <TextField
            label={t("dialog.date")}
            type="date"
            value={date}
            required
            fullWidth
            error={invalid.includes("date")}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              setDate(event.target.value);
              setInvalid([]);
            }}
          />
        </Stack>
        <Typography variant="subtitle2">{t("override.kind")}</Typography>
        <DayOffKindRadios value={kind} onChange={setKind} />
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
                    start: item.startTime ?? "",
                    end: item.endTime ?? "",
                  })}
            </Typography>
            <Button
              variant="text"
              color="error"
              size="small"
              disabled={remove.isPending}
              onClick={() => {
                const missing = reasonRequired && reason === "";
                setInvalid(missing ? ["reason"] : []);
                if (!missing) {
                  remove.mutate({
                    input: { orgId, id: item.id, ...reasonInput },
                  });
                }
              }}
            >
              {t("dialog.delete")}
            </Button>
          </Stack>
        ))}
        {kind === "time-range" && (
          <DayOffSlotFields
            slots={slots}
            invalid={invalid.includes("slots")}
            onChange={setSlots}
          />
        )}
        <SelectField
          label={t("override.reason")}
          value={reason}
          required={reasonRequired}
          fullWidth
          error={invalid.includes("reason")}
          options={reasons.options}
          onChange={(next) => {
            setReason(next);
            setInvalid([]);
          }}
        />
        {reason === REASON_OTHER_VALUE && (
          <TextField
            label={t("override.reasonNote")}
            value={reasonNote}
            required
            fullWidth
            error={invalid.includes("reasonNote")}
            onChange={(event) => {
              setReasonNote(event.target.value);
              setInvalid([]);
            }}
          />
        )}
        <Typography variant="caption" color="text.secondary">
          {t("override.reasonHint")}
        </Typography>
        <DayOffBlockedAlert violations={blocked} />
      </Stack>
    </Dialog>
  );
};
