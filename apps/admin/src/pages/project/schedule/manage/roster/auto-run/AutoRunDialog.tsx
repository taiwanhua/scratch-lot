import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  useRunScheduleAutoRunMutation,
  useScheduleAutoRunPreviewQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { datesOfMonth } from "@/lib/project/schedule-roster";

import { scheduleErrorOf } from "../../../schedule-error";
import { useRosterCheck } from "../check-panel/roster-check-context";
import { ROSTER_QUERY_ROOT } from "../roster-context";
import {
  type AutoRunCondition,
  AutoRunConditionList,
} from "./AutoRunConditionList";
import { autoRunBlockedReasonOf, useAutoRunStatus } from "./auto-run-status";

const MODES = ["fill-empty", "redo-auto", "redo-all"] as const;
type AutoRunMode = (typeof MODES)[number];

export interface AutoRunDialogProps {
  onClose: () => void;
}

/**
 * [自動排班] 對話框(SC-20a;規格 14.5「自動排班」):範圍(預設整個月)、方式三種、
 * 條件(可勾選、拖拉排序;預設 = 這家店的生效設定,整組繼承;只用在這一次)、
 * 這家店有預設人力需求週範本時「先以『一般週』補上人力需求」(預設勾)。
 *
 * - 範圍內沒有人力需求、也沒有可以補的週範本 → 提示並停用 [執行](SC-20c)
 * - 全部重排 → 先確認「將清除 N 個手動排入的人次」(SC-36)
 * - 完成後不彈窗:回排班表、檢核面板自動展開(最上方是這次的摘要,SC-20b)
 */
export const AutoRunDialog = ({ onClose }: AutoRunDialogProps) => {
  const t = useTranslations("admin.schedule.roster.autoRun");
  const tLabels = useTranslations("admin.schedule.rules.labels");
  const tApply = useTranslations("admin.schedule.roster.applyTemplates");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { data, month, setOpen } = useRosterCheck();
  const status = useAutoRunStatus();
  const days = datesOfMonth(month);
  const [from, setFrom] = useState(days.at(0) ?? "");
  const [to, setTo] = useState(days.at(-1) ?? "");
  const [mode, setMode] = useState<AutoRunMode>("fill-empty");
  const [edited, setEdited] = useState<AutoRunCondition[] | null>(null);
  const [fillWeek, setFillWeek] = useState(true);
  const [isConfirming, setConfirming] = useState(false);
  const conditions: AutoRunCondition[] =
    edited ??
    (status?.conditions ?? []).map((condition) => ({
      ...condition,
      label: tLabels(condition.key),
    }));
  const [, monthNumber = ""] = month.split("-");

  const isRangeValid = from !== "" && to !== "" && from <= to;
  const range = {
    month,
    from,
    to,
    ...(data === undefined ? {} : { orgId: data.orgId }),
  };
  const preview = useScheduleAutoRunPreviewQuery(
    session.client,
    { input: range },
    {
      queryKey: [...ROSTER_QUERY_ROOT, "autoRunPreview", range],
      enabled: data !== undefined && isRangeValid,
    },
  ).data?.scheduleAutoRunPreview;
  const weekTemplate = preview?.weekTemplate ?? null;
  const willFill = weekTemplate !== null && fillWeek;
  const isEmpty =
    preview?.demandCount === 0 && !(willFill && preview.fillableDays > 0);

  const errorText = (cause: unknown) => {
    const reason = autoRunBlockedReasonOf(cause);
    return reason === null
      ? tErrors(scheduleErrorOf(cause).code)
      : t(`errors.${reason}`);
  };
  const run = useRunScheduleAutoRunMutation(
    session.client,
    useMutationFeedback({
      success: (payload) =>
        t("feedback", { filled: payload.runScheduleAutoRun.filledCount }),
      error: errorText,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
        setOpen(true);
        onClose();
      },
    }),
  );
  const start = () => {
    setConfirming(false);
    run.mutate({
      input: {
        ...range,
        mode,
        conditions: conditions.map(({ key, enabled }) => ({ key, enabled })),
        fillWeekTemplate: willFill,
      },
    });
  };

  const canRun =
    isRangeValid && preview !== undefined && !isEmpty && !run.isPending;
  const actions = (
    <>
      <Button variant="text" onClick={onClose}>
        {t("cancel")}
      </Button>
      <Button
        disabled={!canRun}
        onClick={() => {
          if (mode === "redo-all") {
            setConfirming(true);
          } else {
            start();
          }
        }}
      >
        {t("run")}
      </Button>
    </>
  );
  const dateFormat = t("dateFormat");

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        fullWidth
        fullScreen={isMobile}
        maxWidth="sm"
        title={t("title")}
        actions={actions}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          {isEmpty && (
            <Alert severity="warning">
              {t("empty", { month: Number(monthNumber) })}
            </Alert>
          )}
          <Stack direction="row" spacing={1.5}>
            <DatePicker
              label={t("from")}
              value={from}
              format={dateFormat}
              minDate={days.at(0)}
              maxDate={days.at(-1)}
              fullWidth
              onChange={(value) => {
                setFrom(value ?? "");
              }}
            />
            <DatePicker
              label={t("to")}
              value={to}
              format={dateFormat}
              minDate={days.at(0)}
              maxDate={days.at(-1)}
              fullWidth
              onChange={(value) => {
                setTo(value ?? "");
              }}
            />
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{t("mode")}</Typography>
            <RadioGroup
              value={mode}
              onChange={(_event, value) => {
                setMode(MODES.find((item) => item === value) ?? "fill-empty");
              }}
            >
              {MODES.map((item) => (
                <FormControlLabel
                  key={item}
                  value={item}
                  control={<Radio />}
                  label={t(`modes.${item}`)}
                />
              ))}
            </RadioGroup>
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{t("conditionsTitle")}</Typography>
            <AutoRunConditionList
              conditions={conditions}
              onChange={setEdited}
              handleLabel={(label) => t("dragHandle", { label })}
            />
            {weekTemplate !== null && (
              <FormControlLabel
                label={t("fillWeek", { name: weekTemplate.name })}
                control={
                  <Checkbox
                    checked={fillWeek}
                    onChange={(_event, checked) => {
                      setFillWeek(checked);
                    }}
                  />
                }
              />
            )}
          </Stack>
          {weekTemplate !== null && (
            <Typography variant="caption" color="textSecondary">
              {/* 同人力需求週範本的說明文字(規格 14.5) */}
              {tApply("hintWeek")}
            </Typography>
          )}
        </Stack>
      </Dialog>
      {isConfirming && (
        <Dialog
          open
          maxWidth="xs"
          onClose={() => {
            setConfirming(false);
          }}
          title={t("confirmTitle")}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t("cancel")}
              </Button>
              <Button color="error" onClick={start}>
                {t("confirm")}
              </Button>
            </>
          }
        >
          <Typography variant="body2">
            {t("confirmBody", { count: preview?.manualCount ?? 0 })}
          </Typography>
        </Dialog>
      )}
    </>
  );
};
