import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  useClearScheduleAutoAssignmentsMutation,
  useScheduleAutoRunPreviewQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { DatePicker } from "@repo/ui/date-picker";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import {
  datesOfMonth,
  dayRangeOf,
  localPartsOf,
} from "@/lib/project/schedule-roster";

import { scheduleErrorKey } from "../../../schedule-error";
import { useRosterCheck } from "../check-panel/roster-check-context";
import { ROSTER_QUERY_ROOT } from "../roster-context";
import { autoRunBlockedReasonOf, useAutoRunStatus } from "./auto-run-status";

/**
 * 檢核面板最上方:最近一次自動排班的摘要(「11/9 14:20 填入 112 人次 · 補上 18 天的人力需求」)與
 * [清除自動排入的人](SC-20b、SC-37;規格 14.5)。沒有自動排班紀錄時不顯示;
 * [清除] 要 `auto-run`、只在未發布的月份。
 */
export const AutoRunSummary = () => {
  const t = useTranslations("admin.schedule.roster.autoRun");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const text = useTemporalText();
  const { data } = useRosterCheck();
  const status = useAutoRunStatus();
  const [isClearing, setClearing] = useState(false);
  const latest = status?.latest;
  if (latest === null || latest === undefined) {
    return null;
  }
  const at = localPartsOf(latest.at, timezone);
  const canClear =
    status?.canAutoRun === true && data?.period.status !== "published";
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
      <Typography variant="body2">
        {t("summary", {
          date: text(latest.at, "monthDay"),
          time: at.time,
          filled: latest.filledCount,
        })}
        {latest.addedDemandDays > 0 &&
          t("summaryDemands", { days: latest.addedDemandDays })}
      </Typography>
      {canClear && (
        <Button
          variant="text"
          size="small"
          sx={{ mt: 0.5, px: 0 }}
          onClick={() => {
            setClearing(true);
          }}
        >
          {t("clear")}
        </Button>
      )}
      {isClearing && (
        <ClearAutoDialog
          onClose={() => {
            setClearing(false);
          }}
        />
      )}
    </Box>
  );
};

/** 清除自動排入的人(SC-37):選日期範圍 → 確認 → 只移除來源 = 自動的填進紀錄。 */
const ClearAutoDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslations("admin.schedule.roster.autoRun");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const { data, month } = useRosterCheck();
  const days = datesOfMonth(month);
  const [from, setFrom] = useState(days.at(0) ?? "");
  const [to, setTo] = useState(days.at(-1) ?? "");
  // 選的是日期(含頭尾);api 收半開的時點區間 `[起 00:00, 迄隔天 00:00)`
  const instants = from <= to ? dayRangeOf(from, to, timezone) : null;
  const isValid = instants !== null;
  const range = {
    month,
    ...(instants ?? { from: "", to: "" }),
    ...(data === undefined ? {} : { orgId: data.orgId }),
  };
  const preview = useScheduleAutoRunPreviewQuery(
    session.client,
    { input: range },
    {
      queryKey: [...ROSTER_QUERY_ROOT, "autoRunPreview", range],
      enabled: data !== undefined && isValid,
    },
  ).data?.scheduleAutoRunPreview;
  const clear = useClearScheduleAutoAssignmentsMutation(
    session.client,
    useMutationFeedback({
      success: (payload) =>
        t("clearFeedback", {
          count: payload.clearScheduleAutoAssignments.removedCount,
        }),
      error: (cause) => {
        const reason = autoRunBlockedReasonOf(cause);
        return reason === null
          ? tErrors(scheduleErrorKey(cause))
          : t(`errors.${reason}`);
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
        onClose();
      },
    }),
  );
  const dateFormat = "M/D";
  return (
    <Dialog
      open
      maxWidth="xs"
      fullWidth
      onClose={onClose}
      title={t("clearTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="error"
            disabled={!isValid || clear.isPending}
            onClick={() => {
              clear.mutate({ input: range });
            }}
          >
            {t("clearConfirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
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
        <Typography variant="body2" color="textSecondary">
          {t("clearBody", { count: preview?.autoCount ?? 0 })}
        </Typography>
      </Stack>
    </Dialog>
  );
};
