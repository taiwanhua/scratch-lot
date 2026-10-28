import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

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

import { FieldErrorGroup } from "@/components/base/FieldErrorGroup/FieldErrorGroup";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { spanOf } from "@/lib/project/schedule-roster";

import { ConfirmDeleteDialog } from "../../ConfirmDeleteDialog";
import { scheduleReasonText } from "../../schedule-field-errors";
import { DemandDialog } from "./DemandDialog";
import { EntryAssignmentRows } from "./EntryAssignmentRows";
import { EntryTimeFields } from "./EntryTimeFields";
import {
  type EntryField,
  type EntryFieldErrors,
  type EntryFormState,
  closedDatePredicateOf,
  entryCheckReasonsOf,
  initialEntryState,
  leaderRuleOf,
  withAddedDemand,
  withTimes,
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
import { useRosterDateTitle } from "./useRosterDateTitle";

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
 * - 至少要填進一筆才能存:移除最後一列時 [儲存] 停用並提示;日期欄的店休日反灰;店休日 [新增一筆人力需求] 也停用
 * - 前端已經知道的規則(店休、畫休、不能擔任負責人;`entryCheckReasonsOf`)送出前就寫在欄位下、
 *   [儲存] 停用,每個入口(工具列、班表空白格、缺額、編輯、疊開新增人力需求)同一套
 * - [刪除這筆排班]:已被收銀班次綁定的擋下(「已經有開班紀錄,不能刪除」)。這個人那天在這家店有未對應排班的打卡:多一個區塊(`UnmatchedPunchesBlock`,SC-04d / SC-04e ①),
 *   勾選的卡儲存時一起對應到這筆排班;「上下班時間改用打卡時間」要 `use-punch-time`、預設不勾
 * - 沒有 `edit`:欄位停用、只剩 [關閉]。電腦 / 平板置中、手機全螢幕
 */
export const EntryDialog = ({
  entry,
  preset = {},
  onClose,
}: EntryDialogProps) => {
  const t = useTranslations("admin.schedule.roster.entryDialog");
  const tCommon = useTranslations("admin.schedule.common");
  const rosterDateTitle = useRosterDateTitle();
  const tSchedule = useTranslations("admin.schedule");
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
      { timezone, breakTiers: data.settings.breakTiers },
    ),
  );
  const [isBreakEdited, setIsBreakEdited] = useState(entry !== null);
  const [isAddingDemand, setIsAddingDemand] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  /** 對話框上方的提示;`isFieldSummary` = 通用句(原因在欄位下),欄位錯誤全清掉就跟著消失(REACT-18) */
  const [error, setError] = useState<{
    text: string;
    isFieldSummary: boolean;
  } | null>(null);
  // 欄位錯了就在欄位正下方寫原因(REACT-18);上方提示只放通用句
  const { fieldErrors, ...errors } = useEntryFieldErrors();
  const changeReason = useChangeReason(canEdit);
  const person = data.people.find((item) => item.userId === form.userId);
  const leaderRule = leaderRuleOf(person, entry);
  const span = spanOf(form.date, form.startTime, form.endTime, timezone);
  const breakMinutes = Number(form.breakText === "" ? "0" : form.breakText);
  const completeRows = form.rows.filter(
    (row) => row.demandId !== "" && row.taskId !== "",
  );
  // 送出前就知道會被擋的(店休、畫休、不能擔任負責人):原因寫在欄位下;api 標回的優先
  const checkReasons = entryCheckReasonsOf(form, {
    calendarDays: data.calendarDays,
    unavailability: data.unavailability,
    demands,
    rule: leaderRule,
    timezone,
  });
  const shownErrors: EntryFieldErrors = { ...fieldErrors };
  for (const [field, reason] of Object.entries(checkReasons) as [
    EntryField,
    (typeof checkReasons)[EntryField],
  ][]) {
    if (reason !== undefined && shownErrors[field] === undefined) {
      shownErrors[field] = scheduleReasonText(tSchedule, reason);
    }
  }
  const alertText =
    error === null ||
    (error.isFieldSummary && Object.keys(fieldErrors).length === 0)
      ? null
      : error.text;
  const timeContext = {
    timezone,
    breakTiers: data.settings.breakTiers,
    isBreakEdited,
  };

  /** 改上下班時間;新增時休息還沒自己改過,就依規則「預設休息」重帶。 */
  const setTimes = (startTime: string, endTime: string) => {
    errors.clear("startTime", "endTime");
    setForm((current) => withTimes(current, startTime, endTime, timeContext));
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
        const { summary, hasFieldErrors } = errors.markFromError(cause);
        setError(
          isReasonError
            ? null
            : { text: summary, isFieldSummary: hasFieldErrors },
        );
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
          blockedEntryIdsOf(cause).length > 0
            ? { text: t("errors.locked"), isFieldSummary: false }
            : null,
        );
      },
    }),
  );

  const canSave =
    canEdit &&
    completeRows.length > 0 &&
    span !== null &&
    Object.keys(checkReasons).length === 0 &&
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

  const dateTitle = rosterDateTitle(form.date);
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
                    setError({
                      text: t("errors.locked"),
                      isFieldSummary: false,
                    });
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
        {alertText !== null && <Alert severity="error">{alertText}</Alert>}
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
              error={shownErrors.userId !== undefined}
              helperText={shownErrors.userId}
              options={data.people
                .filter((item) => item.isCandidate)
                .map((item) => ({ value: item.userId, label: item.name }))}
              onChange={(next) => {
                setForm((current) => ({ ...current, userId: next }));
                // 重疊、畫休(上班欄)與不能擔任負責人(任務那一組)都跟著人,換人一起清
                errors.clear("userId", "startTime", "endTime", "assignments");
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
              shouldDisableDate={closedDatePredicateOf(data.calendarDays)}
              error={shownErrors.date !== undefined}
              helperText={shownErrors.date}
              onChange={(next) => {
                setForm((current) => ({
                  ...current,
                  date: next ?? "",
                  rows: [],
                }));
                // 店休(上班欄)跟著日期;換日期清空了人力需求,那一組的原因也一起清
                errors.clear("date", "startTime", "endTime", "assignments");
              }}
            />
          )}
        </Stack>
        <EntryTimeFields
          startTime={form.startTime}
          endTime={form.endTime}
          breakText={form.breakText}
          disabled={!canEdit}
          fieldErrors={shownErrors}
          onTimes={setTimes}
          onBreak={(text) => {
            setIsBreakEdited(true);
            errors.clear("breakMinutes");
            setForm((current) => ({ ...current, breakText: text }));
          }}
        />
        {entry === null && punches.block}
        <FieldErrorGroup
          label={t("assignments")}
          errorText={shownErrors.assignments}
        >
          <EntryAssignmentRows
            rows={form.rows}
            setRows={(update) => {
              errors.clear("assignments");
              setForm((current) => ({
                ...current,
                rows:
                  typeof update === "function" ? update(current.rows) : update,
              }));
            }}
            dayDemands={demands.filter((demand) => demand.date === form.date)}
            entryId={entry?.id ?? null}
            leaderRule={leaderRule}
            span={span}
            onExtend={(edge, time) => {
              if (edge === "end") {
                setTimes(form.startTime, time);
              } else {
                setTimes(time, form.endTime);
              }
            }}
            isAddDemandDisabled={checkReasons.startTime === "STORE_CLOSED"}
            onAddDemand={() => {
              if (form.date !== "") {
                setIsAddingDemand(true);
              }
            }}
          />
        </FieldErrorGroup>
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
            errors.clear("assignments");
            setForm((current) =>
              withAddedDemand(current, created, leaderRule, timeContext),
            );
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
