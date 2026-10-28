import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  MAX_HELPER_TASKS,
  MAX_LEADER_TASKS,
  type ScheduleTaskRole,
} from "@repo/domain/project/schedule-settings";
import {
  type ScheduleDemandFieldsFragment,
  useDeleteScheduleDemandMutation,
  useSaveScheduleDemandMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TimePicker } from "@repo/ui/time-picker";

import { FieldErrorGroup } from "@/components/base/FieldErrorGroup/FieldErrorGroup";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import { dayKeyOf } from "@/lib/project/schedule-day-offs";
import { demandRemovalImpact, spanOf } from "@/lib/project/schedule-roster";

import { DemandImpactDialog } from "./DemandImpactDialog";
import { DemandTaskList } from "./DemandTaskList";
import { DemandTemplateCopyFields } from "./DemandTemplateCopyFields";
import {
  type DemandField,
  type DemandValues,
  initialDemandValues,
  missingDemandFields,
  nextTaskKey,
  withClosedReason,
} from "./demand-dialog-state";
import { closedDatePredicateOf } from "./entry-dialog-state";
import { useChangeReason } from "./publish/useChangeReason";
import {
  type DemandPreset,
  ROSTER_QUERY_ROOT,
  type RosterDemand,
  useRoster,
} from "./roster-context";
import { blockedEntryIdsOf } from "./roster-error";
import { useDemandFieldErrors } from "./useDemandFieldErrors";
import { useRosterDateTitle } from "./useRosterDateTitle";

export interface DemandDialogProps {
  /** 要看 / 改的那一筆;null = 新增 */
  demand: RosterDemand | null;
  preset?: DemandPreset;
  /** 從排班對話框疊開:日期鎖定為那筆排班那天 */
  isDateLocked?: boolean;
  onClose: () => void;
  /** 存檔成功(新增時給新的那一筆;疊開時回到排班對話框自動加一列) */
  onSaved?: (demand: ScheduleDemandFieldsFragment) => void;
}

/**
 * 人力需求對話框(SC-21a 新增 / SC-21b 編輯 / SC-21c 刪除確認 / SC-21d 同時存成範本 / SC-33b 唯讀;
 * 規格 14.5「兩種對話框」):日期、崗位、開始 / 結束;「負責人」0–1 列、「協同」0–10 列
 * (新增一列帶入規則的負責人 / 協同預設任務);不選人、不顯示排班,只在每列旁寫誰填進。
 *
 * - 移除有人填的那一列、或 [刪除人力需求]:確認視窗列出會解除的人、會一起刪的排班(零筆),
 *   被收銀班次綁定的擋下並列出
 * - 「同時存成人力需求範本」:只在新增、有 `edit-templates` 時出現
 * - 已經有人填的人力需求不能改日期(要搬日期先解除)
 * - 店休那天(或跨午夜做進隔天店休)不能建人力需求:日期欄的店休日反灰;送出前就在開始時間欄下寫原因、
 *   [新增] / [儲存] 停用(同排班對話框);店休日既有的那筆只能 [刪除人力需求]
 * - 沒有 `edit`:欄位停用、只剩 [關閉]。電腦 / 平板置中、手機全螢幕
 */
export const DemandDialog = ({
  demand,
  preset = {},
  isDateLocked = false,
  onClose,
  onSaved,
}: DemandDialogProps) => {
  const t = useTranslations("admin.schedule.roster.demandDialog");
  const tRoster = useTranslations("admin.schedule.roster");
  const tCommon = useTranslations("admin.schedule.common");
  const tSchedule = useTranslations("admin.schedule");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { data, timezone, canEdit } = useRoster();
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const taskOptions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.task,
  );
  const template =
    demand === null
      ? data.templates.find((item) => item.id === preset.templateId)
      : undefined;
  const [values, setValues] = useState<DemandValues>(() =>
    initialDemandValues(demand, preset, template, timezone),
  );
  // 欄位錯了就在欄位正下方寫原因(REACT-18);提示只放通用句
  const { fieldErrors, invalid, ...errors } = useDemandFieldErrors();
  const [confirm, setConfirm] = useState<"save" | "delete" | null>(null);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const changeReason = useChangeReason(canEdit);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
  const errorText = errors.summaryOf;
  const handleError = (error: unknown) => {
    changeReason.markFromError(error);
    setBlockedIds(blockedEntryIdsOf(error));
    errors.markFromError(error);
  };

  const save = useSaveScheduleDemandMutation(
    session.client,
    useMutationFeedback({
      success: demand === null ? t("feedback.created") : t("feedback.saved"),
      error: errorText,
      onSuccess: (result) => {
        void invalidate();
        // api 回的日期是時點;交給排班對話框前換成日期鍵(同頁殼的 `rosterDataOf`)
        const saved = result.saveScheduleDemand.item;
        onSaved?.({ ...saved, date: dayKeyOf(saved.date, timezone) });
        onClose();
      },
      onError: handleError,
    }),
  );
  const remove = useDeleteScheduleDemandMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.deleted"),
      error: errorText,
      onSuccess: () => {
        void invalidate();
        onClose();
      },
      onError: handleError,
    }),
  );

  const change = <Key extends keyof DemandValues>(
    key: Key,
    value: DemandValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
    errors.clear(key as DemandField);
  };
  const addTask = (role: ScheduleTaskRole) => {
    change("tasks", [
      ...values.tasks,
      {
        taskId: null,
        key: nextTaskKey(),
        role,
        taskKey:
          role === "leader"
            ? data.settings.defaultLeaderTaskKey
            : data.settings.defaultHelperTaskKey,
        userName: null,
      },
    ]);
  };
  const changeTask = (key: string, taskKey: string) => {
    change(
      "tasks",
      values.tasks.map((task) =>
        task.key === key ? { ...task, taskKey } : task,
      ),
    );
  };
  const removeTask = (key: string) => {
    change(
      "tasks",
      values.tasks.filter((task) => task.key !== key),
    );
  };

  const keptTaskIds = new Set(values.tasks.map((task) => task.taskId));
  const removedTasks = (demand?.tasks ?? []).filter(
    (task) => !keptTaskIds.has(task.taskId),
  );
  const impactOf = (tasks: RosterDemand["tasks"]) =>
    demandRemovalImpact(demand?.id ?? "", tasks, data.entries);
  const hasFilledTask =
    demand?.tasks.some((task) => typeof task.entryId === "string") === true;
  // 店休那天(或跨午夜做進隔天店休)不能建人力需求;店休日既有的那筆不能改、只能刪(api 一樣會擋)
  const { isClosed, shownErrors } = withClosedReason(
    values,
    fieldErrors,
    { calendarDays: data.calendarDays, timezone },
    tSchedule,
  );

  const submit = (confirmed: boolean) => {
    const missing = missingDemandFields(values);
    errors.markMissing(missing);
    const span = spanOf(
      values.date,
      values.startTime,
      values.endTime,
      timezone,
    );
    const reason = changeReason.take();
    if (missing.length > 0 || span === null || reason === null) {
      return;
    }
    if (!confirmed && impactOf(removedTasks).released.length > 0) {
      setConfirm("save");
      return;
    }
    save.mutate({
      input: {
        ...reason,
        orgId: data.orgId,
        ...(demand === null ? {} : { id: demand.id }),
        ...span,
        positionKey: values.positionKey,
        tasks: values.tasks.map((task) => ({
          ...(task.taskId === null ? {} : { taskId: task.taskId }),
          role: task.role,
          taskKey: task.taskKey,
        })),
        ...(template === undefined ? {} : { templateId: template.id }),
        ...(values.saveAsTemplate
          ? {
              saveAsTemplate: {
                name: values.templateName.trim(),
                shortName: values.templateShortName.trim(),
              },
            }
          : {}),
      },
    });
  };

  const templateName =
    data.templates.find((item) => item.id === demand?.templateId)?.name ??
    tRoster("cell.temp");
  const dateTitle = useRosterDateTitle();
  const title =
    demand === null
      ? t("createTitle")
      : t("editTitle", { date: dateTitle(demand.date), name: templateName });

  const taskList = (role: ScheduleTaskRole, max: number) => {
    const rows = values.tasks.filter((task) => task.role === role);
    return (
      <DemandTaskList
        role={role}
        rows={rows}
        isFull={rows.length >= max}
        canEdit={canEdit}
        taskOptions={taskOptions.options}
        onAdd={() => {
          addTask(role);
        }}
        onChange={changeTask}
        onRemove={removeTask}
      />
    );
  };

  const confirmImpact =
    confirm === "delete"
      ? impactOf(demand?.tasks ?? [])
      : impactOf(removedTasks);

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
            {demand !== null && (
              <Button
                variant="text"
                color="error"
                sx={{ mr: "auto" }}
                onClick={() => {
                  if (changeReason.take() !== null) {
                    setConfirm("delete");
                  }
                }}
              >
                {t("delete")}
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={save.isPending || isClosed}
              onClick={() => {
                submit(false);
              }}
            >
              {demand === null ? t("create") : tCommon("save")}
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
        {template !== undefined && (
          <Alert severity="info">
            {t("templateApplied", { name: template.name })}
          </Alert>
        )}
        {blockedIds.length > 0 && (
          <Alert severity="error">{t("blocked")}</Alert>
        )}
        <Stack direction="row" spacing={1.5}>
          <DatePicker
            label={t("date")}
            value={values.date === "" ? null : values.date}
            required
            fullWidth
            disabled={!canEdit || isDateLocked || hasFilledTask}
            shouldDisableDate={closedDatePredicateOf(data.calendarDays)}
            error={invalid.includes("date")}
            helperText={fieldErrors.date}
            onChange={(next) => {
              change("date", next ?? "");
              // 店休(開始時間欄)跟著日期
              errors.clear("startTime");
            }}
          />
          <SelectField
            label={t("position")}
            value={values.positionKey}
            required
            fullWidth
            disabled={!canEdit}
            error={invalid.includes("positionKey")}
            helperText={fieldErrors.positionKey}
            options={positions.options}
            onChange={(next) => {
              change("positionKey", next);
            }}
          />
        </Stack>
        <Stack direction="row" spacing={1.5}>
          {(["startTime", "endTime"] as const).map((field) => (
            <TimePicker
              key={field}
              label={t(field)}
              value={values[field] === "" ? null : values[field]}
              required
              fullWidth
              disabled={!canEdit}
              error={shownErrors[field] !== undefined}
              helperText={shownErrors[field]}
              onChange={(next) => {
                change(field, next ?? "");
              }}
            />
          ))}
        </Stack>
        <FieldErrorGroup
          label={t("tasks")}
          errorText={fieldErrors.tasks}
          spacing={2}
        >
          {taskList("leader", MAX_LEADER_TASKS)}
          {taskList("helper", MAX_HELPER_TASKS)}
        </FieldErrorGroup>
        {demand === null && canEdit && data.canSaveTemplate && (
          <DemandTemplateCopyFields
            values={values}
            fieldErrors={fieldErrors}
            onChange={change}
          />
        )}
        {changeReason.fields}
      </Stack>
      {confirm !== null && demand !== null && (
        <DemandImpactDialog
          mode={confirm}
          title={
            confirm === "delete"
              ? t("deleteConfirmTitle", {
                  date: dateTitle(demand.date),
                  name: templateName,
                })
              : t("removeConfirmTitle")
          }
          released={confirmImpact.released}
          deleted={confirmImpact.deleted}
          blocked={confirmImpact.blocked}
          names={
            new Map(data.people.map((person) => [person.userId, person.name]))
          }
          taskLabelOf={taskOptions.labelOf}
          isPending={save.isPending || remove.isPending}
          onCancel={() => {
            setConfirm(null);
          }}
          onConfirm={() => {
            if (confirm === "delete") {
              remove.mutate({
                input: changeReason.withReason({
                  orgId: data.orgId,
                  id: demand.id,
                }),
              });
            } else {
              submit(true);
            }
            setConfirm(null);
          }}
        />
      )}
    </Dialog>
  );
};
