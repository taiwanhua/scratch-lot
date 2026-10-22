import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { defaultBreakMinutes } from "@repo/domain/project/schedule-settings";
import {
  useDeleteScheduleEntryMutation,
  useSaveScheduleEntryMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { FieldErrorText } from "@/components/base/FieldErrorText/FieldErrorText";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  minutesBetween,
  monthDayOf,
  spanOf,
  weekdayOf,
} from "@/lib/project/schedule-roster";

import { ConfirmDeleteDialog } from "../../ConfirmDeleteDialog";
import { DemandDialog } from "./DemandDialog";
import { EntryAssignmentRows } from "./EntryAssignmentRows";
import {
  type EntryFormState,
  initialEntryState,
  withAddedDemand,
} from "./entry-dialog-state";
import { useChangeReason } from "./publish/useChangeReason";
import {
  type EntryPreset,
  ROSTER_QUERY_ROOT,
  type RosterDemand,
  type RosterEntry,
  useRoster,
} from "./roster-context";
import { blockedEntryIdsOf } from "./roster-error";
import { useEntryFieldErrors } from "./useEntryFieldErrors";
import { useEntryPunches } from "./useEntryPunches";

export interface EntryDialogProps {
  /** 要看 / 改的那一筆;null = 新增 */
  entry: RosterEntry | null;
  preset?: EntryPreset;
  onClose: () => void;
}

/**
 * 排班對話框(SC-04a 新增 / SC-04b 編輯 / SC-04c 負責人時間涵蓋提示 / SC-04e ②③ 疊開新增人力需求 /
 * SC-04f 刪除 / SC-33a 唯讀;規格 14.5「兩種對話框」):人員(帶入後不能改)、上下班時間、休息
 * (新增時依規則「預設休息」帶入,可以改)、「加入這天的人力需求」(`EntryAssignmentRows`)。
 *
 * - [新增一筆人力需求]:疊開人力需求對話框(日期鎖定、時間帶入這筆排班);新增成功 → 自動加一列
 *   (依規則填第一個空的任務);取消 → 不變;之後排班按取消,人力需求保留(它已經獨立存檔)
 * - 至少要填進一筆才能存:移除最後一列時 [儲存] 停用並提示
 * - [刪除這筆排班]:已被收銀班次綁定的擋下(「已經有開班紀錄,不能刪除」)
 * - 這個人那天在這家店有未對應排班的打卡:多一個區塊(`UnmatchedPunchesBlock`,SC-04d / SC-04e ①),
 *   勾選的卡儲存時一起對應到這筆排班;「上下班時間改用打卡時間」要 `use-punch-time`、預設不勾
 * - 沒有 `edit`:欄位停用、只剩 [關閉]。電腦 / 平板置中、手機全螢幕
 */
export const EntryDialog = ({
  entry,
  preset = {},
  onClose,
}: EntryDialogProps) => {
  const t = useTranslations("admin.schedule.roster.entryDialog");
  const tRoster = useTranslations("admin.schedule.roster");
  const tCommon = useTranslations("admin.schedule.common");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { data, timezone, canEdit } = useRoster();
  /** 疊開新增、還沒出現在排班表資料裡的人力需求 */
  const [addedDemands, setAddedDemands] = useState<RosterDemand[]>([]);
  const demands = [
    ...data.demands.filter(
      (demand) => !addedDemands.some((added) => added.id === demand.id),
    ),
    ...addedDemands,
  ];
  const [form, setForm] = useState<EntryFormState>(() =>
    initialEntryState(
      entry,
      preset,
      data.demands.find((demand) => demand.id === preset.demandId),
      timezone,
    ),
  );
  const [isBreakEdited, setIsBreakEdited] = useState(entry !== null);
  const [isAddingDemand, setIsAddingDemand] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);上方提示只放通用句
  const { fieldErrors, ...errors } = useEntryFieldErrors();
  const changeReason = useChangeReason(canEdit);

  const person = data.people.find((item) => item.userId === form.userId);
  const canLead = person?.canLead === true;
  const span = spanOf(form.date, form.startTime, form.endTime, timezone);
  const breakMinutes = Number(form.breakText === "" ? "0" : form.breakText);
  const completeRows = form.rows.filter(
    (row) => row.demandId !== "" && row.taskId !== "",
  );

  /** 改上下班時間;新增時休息還沒自己改過,就依規則「預設休息」重帶。 */
  const setTimes = (startTime: string, endTime: string) => {
    errors.clear("startTime", "endTime");
    const next = spanOf(form.date, startTime, endTime, timezone);
    setForm((current) => ({
      ...current,
      startTime,
      endTime,
      breakText:
        isBreakEdited || next === null
          ? current.breakText
          : String(
              defaultBreakMinutes(
                data.settings.breakTiers,
                minutesBetween(next.startAt, next.endAt),
              ),
            ),
    }));
  };

  const punches = useEntryPunches(form, person?.name ?? "", {
    span,
    canEdit,
    setTimes,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
  const errorText = errors.summaryOf;
  const save = useSaveScheduleEntryMutation(
    session.client,
    useMutationFeedback({
      success: entry === null ? t("feedback.created") : t("feedback.saved"),
      error: errorText,
      onSuccess: () => {
        void invalidate();
        onClose();
      },
      onError: (cause) => {
        const isReasonError = changeReason.markFromError(cause);
        const summary = errors.markFromError(cause);
        setError(isReasonError ? null : summary);
      },
    }),
  );
  const remove = useDeleteScheduleEntryMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.deleted"),
      error: errorText,
      onSuccess: () => {
        void invalidate();
        onClose();
      },
      onError: (cause) => {
        changeReason.markFromError(cause);
        setError(
          blockedEntryIdsOf(cause).length > 0 ? t("errors.locked") : null,
        );
      },
    }),
  );

  const canSave =
    canEdit &&
    completeRows.length > 0 &&
    span !== null &&
    form.userId !== "" &&
    Number.isInteger(breakMinutes) &&
    breakMinutes >= 0;

  const submit = () => {
    // 已發布的月份:異動原因沒填好 → 標紅、不送
    if (!canSave || changeReason.take() === null) {
      return;
    }
    save.mutate({
      input: changeReason.withReason({
        orgId: data.orgId,
        ...(entry === null ? { userId: form.userId } : { id: entry.id }),
        startAt: span.startAt,
        endAt: span.endAt,
        breakMinutes,
        assignments: completeRows.map((row) => ({
          demandId: row.demandId,
          taskId: row.taskId,
        })),
        ...punches.inputPart,
      }),
    });
  };

  const dateTitle =
    form.date === ""
      ? ""
      : tRoster("dateTitle", {
          date: monthDayOf(form.date),
          weekday: tCalendar(`weekdays.${String(weekdayOf(form.date))}`),
        });
  const title =
    entry === null
      ? t("createTitle", { date: dateTitle })
      : t("editTitle", { name: person?.name ?? "", date: dateTitle });
  const isPersonFixed = entry !== null || preset.userId !== undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={title}
      actions={
        canEdit ? (
          <>
            {entry !== null && (
              <Button
                variant="text"
                color="error"
                sx={{ mr: "auto" }}
                onClick={() => {
                  if (!entry.deletable) {
                    setError(t("errors.locked"));
                  } else if (changeReason.take() !== null) {
                    setIsConfirmingDelete(true);
                  }
                }}
              >
                {t("delete")}
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button disabled={!canSave || save.isPending} onClick={submit}>
              {tCommon("save")}
            </Button>
          </>
        ) : (
          <Button variant="text" onClick={onClose}>
            {tCommon("close")}
          </Button>
        )
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {error !== null && <Alert severity="error">{error}</Alert>}
        {changeReason.alert}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          {isPersonFixed ? (
            <TextField
              label={t("person")}
              value={person?.name ?? ""}
              fullWidth
              disabled
            />
          ) : (
            <SelectField
              label={t("person")}
              value={form.userId}
              required
              fullWidth
              disabled={!canEdit}
              error={fieldErrors.userId !== undefined}
              helperText={fieldErrors.userId}
              options={data.people
                .filter((item) => item.isCandidate)
                .map((item) => ({ value: item.userId, label: item.name }))}
              onChange={(next) => {
                setForm((current) => ({ ...current, userId: next }));
                errors.clear("userId");
              }}
            />
          )}
          {entry === null && preset.date === undefined && (
            <DatePicker
              label={t("date")}
              value={form.date === "" ? null : form.date}
              required
              fullWidth
              disabled={!canEdit}
              onChange={(next) => {
                setForm((current) => ({
                  ...current,
                  date: next ?? "",
                  rows: [],
                }));
              }}
            />
          )}
        </Stack>
        <Stack direction="row" spacing={1.5}>
          <TextField
            label={t("startTime")}
            type="time"
            value={form.startTime}
            required
            fullWidth
            disabled={!canEdit}
            error={fieldErrors.startTime !== undefined}
            helperText={fieldErrors.startTime}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              setTimes(event.target.value, form.endTime);
            }}
          />
          <TextField
            label={t("endTime")}
            type="time"
            value={form.endTime}
            required
            fullWidth
            disabled={!canEdit}
            error={fieldErrors.endTime !== undefined}
            helperText={fieldErrors.endTime}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              setTimes(form.startTime, event.target.value);
            }}
          />
          <TextField
            label={t("breakMinutes")}
            type="number"
            value={form.breakText}
            fullWidth
            disabled={!canEdit}
            error={fieldErrors.breakMinutes !== undefined}
            helperText={fieldErrors.breakMinutes}
            slotProps={{ htmlInput: { min: 0, step: 5 } }}
            onChange={(event) => {
              setIsBreakEdited(true);
              setForm((current) => ({
                ...current,
                breakText: event.target.value,
              }));
            }}
          />
        </Stack>
        {entry === null && punches.block}
        <EntryAssignmentRows
          rows={form.rows}
          setRows={(update) => {
            setForm((current) => ({
              ...current,
              rows:
                typeof update === "function" ? update(current.rows) : update,
            }));
          }}
          dayDemands={demands.filter((demand) => demand.date === form.date)}
          entryId={entry?.id ?? null}
          canLead={canLead}
          span={span}
          onExtend={(edge, time) => {
            if (edge === "end") {
              setTimes(form.startTime, time);
            } else {
              setTimes(time, form.endTime);
            }
          }}
          onAddDemand={() => {
            if (form.date !== "") {
              setIsAddingDemand(true);
            }
          }}
        />
        <FieldErrorText text={fieldErrors.assignments} />
        {entry !== null && punches.block}
        {changeReason.fields}
      </Stack>
      {isAddingDemand && (
        <DemandDialog
          demand={null}
          isDateLocked
          preset={{
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
          }}
          onClose={() => {
            setIsAddingDemand(false);
          }}
          onSaved={(created) => {
            setAddedDemands((current) => [...current, created]);
            setForm((current) => withAddedDemand(current, created, canLead));
          }}
        />
      )}
      {isConfirmingDelete && entry !== null && (
        <ConfirmDeleteDialog
          title={t("delete")}
          message={t("deleteConfirm", {
            name: person?.name ?? "",
            date: dateTitle,
          })}
          isPending={remove.isPending}
          onConfirm={() => {
            remove.mutate({
              input: changeReason.withReason({
                orgId: data.orgId,
                id: entry.id,
              }),
            });
            setIsConfirmingDelete(false);
          }}
          onCancel={() => {
            setIsConfirmingDelete(false);
          }}
        />
      )}
    </Dialog>
  );
};
