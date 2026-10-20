import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type AddMyScheduleDayOffsMutation,
  type ScheduleDayOffFieldsFragment,
  useAddMyScheduleDayOffsMutation,
  useDeleteMyScheduleDayOffMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { DayOffBlockedAlert } from "@/components/project/schedule/DayOffs/DayOffBlockedAlert";
import { DayOffKindRadios } from "@/components/project/schedule/DayOffs/DayOffKindRadios";
import { DayOffSlotFields } from "@/components/project/schedule/DayOffs/DayOffSlotFields";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useDayOffDateTitle } from "@/hooks/project/schedule/useDayOffDateTitle/useDayOffDateTitle";
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

/** codegen 的 query key 第一段是 operation 名稱(`useMyScheduleDayOffsQuery.getKey`)。 */
const MY_DAY_OFFS_QUERY_KEY = "MyScheduleDayOffs";

export interface DayOffDialogProps {
  /** 帶入的日期(點日期);[登記畫休] 為空字串 */
  initialDate: string;
  /** 開放中的目標月(日期只能選這個月) */
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
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const dateTitle = useDayOffDateTitle();
  const [date, setDate] = useState(initialDate);
  const [kind, setKind] = useState<DayOffKind>("full-day");
  const [slots, setSlots] = useState<DayOffSlot[]>([EMPTY_SLOT]);
  const [invalid, setInvalid] = useState(false);
  const [blocked, setBlocked] = useState<ScheduleDayOffViolationError[]>([]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [MY_DAY_OFFS_QUERY_KEY] });
  };
  const errorOf = (error: unknown) => tErrors(scheduleErrorOf(error).code);
  const save = useAddMyScheduleDayOffsMutation(
    session.client,
    useMutationFeedback<AddMyScheduleDayOffsMutation>({
      success: (data) =>
        data.addMyScheduleDayOffs.violations.length > 0
          ? t("dialog.savedWithReminders")
          : t("dialog.saveSuccess"),
      error: errorOf,
      onSuccess: () => {
        refresh();
        onClose();
      },
      onError: (error) => {
        setBlocked(dayOffViolationsOf(error));
        setInvalid(scheduleErrorOf(error).fields?.includes("slots") ?? false);
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

  const existing = myDayOffs.filter((item) => item.date === date);

  const submit = () => {
    if (date === "") {
      setInvalid(true);
      return;
    }
    const picked = completeSlots(slots);
    if (kind === "time-range" && picked === null) {
      setInvalid(true);
      return;
    }
    setBlocked([]);
    save.mutate({
      input: {
        date,
        kind,
        ...(kind === "time-range" && picked !== null ? { slots: picked } : {}),
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
          <Button disabled={save.isPending} onClick={submit}>
            {tCommon("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={t("dialog.date")}
          type="date"
          value={date}
          required
          fullWidth
          error={invalid && date === ""}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { min: `${month}-01`, max: `${month}-31` },
          }}
          onChange={(event) => {
            setDate(event.target.value);
            setInvalid(false);
            setBlocked([]);
          }}
        />
        <DayOffKindRadios
          value={kind}
          onChange={(next) => {
            setKind(next);
            setInvalid(false);
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
            invalid={invalid}
            onChange={(next) => {
              setSlots(next);
              setInvalid(false);
            }}
            allowMultiple
          />
        )}
        <DayOffBlockedAlert violations={blocked} />
      </Stack>
    </Dialog>
  );
};
