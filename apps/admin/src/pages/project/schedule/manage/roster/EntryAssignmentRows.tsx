import type { Dispatch, SetStateAction } from "react";
import { useTranslations } from "use-intl";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { leaderCoverageGaps } from "@repo/domain/project/schedule-settings";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import { localPartsOf } from "@/lib/project/schedule-roster";

import { scheduleReasonText } from "../../schedule-field-errors";
import {
  type AssignmentRow,
  type LeaderRule,
  isLeaderBlocked,
  nextRowKey,
  pickTaskOf,
  tasksWithFilled,
} from "./entry-dialog-state";
import { type RosterDemand, useRoster } from "./roster-context";

export interface EntryAssignmentRowsProps {
  rows: readonly AssignmentRow[];
  setRows: Dispatch<SetStateAction<AssignmentRow[]>>;
  /** 這天的人力需求(含疊開剛新增的) */
  dayDemands: readonly RosterDemand[];
  /** 編輯中的排班 id(它自己填的任務不算「別人填了」) */
  entryId: string | null;
  /** 負責人任務誰能填(選的人、編輯中原本填著的;`leaderRuleOf`) */
  leaderRule: LeaderRule;
  /** 目前的上下班時點(負責人時間涵蓋提示用);時間還沒填好為 null */
  span: { startAt: string; endAt: string } | null;
  /** 改上下班時間([往後延長到] / [往前延長到]) */
  onExtend: (edge: "start" | "end", time: string) => void;
  onAddDemand: () => void;
}

/**
 * 排班對話框的「加入這天的人力需求」(規格 14.5):標題列右邊 [新增一筆人力需求](疊開人力需求對話框);
 * 每列 = 人力需求 + 職責 · 執行任務 + [移除];清單最下面 [+ 加入人力需求] 從這天已有的加一列;
 * 這天沒有人力需求時寫「這天沒有合適的人力需求」。負責人沒涵蓋那筆人力需求 → 提示與延長按鈕。
 * 不能選的任務反灰,原因寫在選項的次文字(STYLE-05「停用的選項」):別人填了 → 誰填的;
 * 選的人不能擔任負責人 → 那句原因(和 api 擋下時同一句;選中的那一項不重複寫,原因在這一組下方)。
 */
export const EntryAssignmentRows = ({
  rows,
  setRows,
  dayDemands,
  entryId,
  leaderRule,
  span,
  onExtend,
  onAddDemand,
}: EntryAssignmentRowsProps) => {
  const t = useTranslations("admin.schedule.roster.entryDialog");
  const tRoster = useTranslations("admin.schedule.roster");
  const tCommon = useTranslations("admin.schedule.common");
  const tSchedule = useTranslations("admin.schedule");
  const { data, timezone, canEdit } = useRoster();
  const positions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.position,
  );
  const taskOptions = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.task,
  );
  const time = (iso: string) => localPartsOf(iso, timezone).time;
  const nameOf = (demand: RosterDemand) =>
    data.templates.find((item) => item.id === demand.templateId)?.name ??
    tRoster("cell.temp");
  const demandOf = (id: string) => dayDemands.find((item) => item.id === id);
  const roleText = (role: string) =>
    tRoster(`cell.roles.${role === "leader" ? "leader" : "helper"}`);

  const updateRow = (key: string, patch: Partial<AssignmentRow>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const removeRow = (key: string) => {
    setRows((current) => current.filter((item) => item.key !== key));
  };

  const pickDemand = (key: string, demandId: string) => {
    const demand = demandOf(demandId);
    updateRow(key, {
      demandId,
      taskId:
        demand === undefined ? "" : pickTaskOf(demand, entryId, leaderRule),
    });
  };

  /** 選中的那一項不另寫次文字(收合時只顯示任務;原因已寫在這一組下方) */
  const taskOptionsOf = (demand: RosterDemand, selectedTaskId: string) =>
    tasksWithFilled(demand, entryId).map((task) => {
      const text = task.filled
        ? t("taskOptionFilled", {
            role: roleText(task.role),
            task: taskOptions.labelOf(task.taskKey),
            name: task.userName ?? "",
          })
        : t("taskOption", {
            role: roleText(task.role),
            task: taskOptions.labelOf(task.taskKey),
          });
      const isBlocked = isLeaderBlocked(leaderRule, demand.id, task);
      return {
        value: task.taskId,
        label:
          isBlocked && task.taskId !== selectedTaskId ? (
            <Stack>
              <span>{text}</span>
              <Typography variant="caption" color="textSecondary">
                {scheduleReasonText(tSchedule, "CANNOT_LEAD")}
              </Typography>
            </Stack>
          ) : (
            text
          ),
        disabled: task.filled || isBlocked,
      };
    });

  const coverageHint = (row: AssignmentRow) => {
    const demand = demandOf(row.demandId);
    const task = demand?.tasks.find((item) => item.taskId === row.taskId);
    if (demand === undefined || task?.role !== "leader" || span === null) {
      return null;
    }
    const gaps = leaderCoverageGaps(
      { startAt: Date.parse(span.startAt), endAt: Date.parse(span.endAt) },
      { startAt: Date.parse(demand.startAt), endAt: Date.parse(demand.endAt) },
    );
    if (gaps.extendStartTo === null && gaps.extendEndTo === null) {
      return null;
    }
    return (
      <Alert severity="warning">
        <Typography variant="body2">
          {t("coverage", {
            name: nameOf(demand),
            start: time(demand.startAt),
            end: time(demand.endAt),
          })}
        </Typography>
        {canEdit && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            {gaps.extendEndTo !== null && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  onExtend("end", time(demand.endAt));
                }}
              >
                {t("extendEnd", { time: time(demand.endAt) })}
              </Button>
            )}
            {gaps.extendStartTo !== null && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  onExtend("start", time(demand.startAt));
                }}
              >
                {t("extendStart", { time: time(demand.startAt) })}
              </Button>
            )}
          </Stack>
        )}
      </Alert>
    );
  };

  const complete = rows.filter(
    (row) => row.demandId !== "" && row.taskId !== "",
  );

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Typography variant="subtitle2">{t("demandsTitle")}</Typography>
        {canEdit && (
          <Button
            variant="text"
            size="small"
            sx={{ ml: "auto" }}
            onClick={onAddDemand}
          >
            {t("addNewDemand")}
          </Button>
        )}
      </Stack>
      {dayDemands.length === 0 && (
        <Typography variant="body2" color="textSecondary">
          {t("noDemand")}
        </Typography>
      )}
      {rows.map((row) => {
        const demand = demandOf(row.demandId);
        return (
          <Stack key={row.key} spacing={1}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" } }}
            >
              <SelectField
                label={t("demand")}
                value={row.demandId}
                size="small"
                fullWidth
                disabled={!canEdit}
                options={dayDemands.map((item) => ({
                  value: item.id,
                  label: t("demandOption", {
                    name: nameOf(item),
                    start: time(item.startAt),
                    end: time(item.endAt),
                    position: positions.labelOf(item.positionKey),
                  }),
                  disabled: rows.some(
                    (other) =>
                      other.key !== row.key && other.demandId === item.id,
                  ),
                }))}
                onChange={(next) => {
                  pickDemand(row.key, next);
                }}
              />
              <SelectField
                label={t("task")}
                value={row.taskId}
                size="small"
                fullWidth
                disabled={!canEdit || demand === undefined}
                options={
                  demand === undefined ? [] : taskOptionsOf(demand, row.taskId)
                }
                onChange={(next) => {
                  updateRow(row.key, { taskId: next });
                }}
              />
              {canEdit && (
                <Button
                  variant="text"
                  color="error"
                  size="small"
                  onClick={() => {
                    removeRow(row.key);
                  }}
                >
                  {tCommon("remove")}
                </Button>
              )}
            </Stack>
            {coverageHint(row)}
          </Stack>
        );
      })}
      {canEdit && dayDemands.length > 0 && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            setRows((current) => [
              ...current,
              { key: nextRowKey(), demandId: "", taskId: "" },
            ]);
          }}
        >
          {t("addRow")}
        </Button>
      )}
      {canEdit && complete.length === 0 && (
        <Typography variant="caption" sx={{ color: "warning.dark" }}>
          {t("atLeastOne")}
        </Typography>
      )}
    </Stack>
  );
};
