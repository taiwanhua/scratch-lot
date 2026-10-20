import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import { useRemoveScheduleDayEntriesMutation } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  localPartsOf,
  monthDayOf,
  weekdayOf,
} from "@/lib/project/schedule-roster";

import { scheduleErrorOf } from "../../schedule-error";
import { useChangeReason } from "./publish/useChangeReason";
import { ROSTER_QUERY_ROOT, useRoster } from "./roster-context";

export interface RemoveDayDialogProps {
  date: string;
  onClose: () => void;
}

/**
 * 移除這天所有排班(SC-50;規格 14.5,颱風停班等):列出會刪除的排班(職責一起移除);
 * 已被開班綁定的略過並列出。照常上班、雙倍薪水的日子不用移除,到行事曆標成特殊日。
 * 已發布後多一個「異動原因」(只填一次,每筆刪除的排班各記一筆異動;`useChangeReason`)。
 */
export const RemoveDayDialog = ({ date, onClose }: RemoveDayDialogProps) => {
  const t = useTranslations("admin.schedule.roster.removeDay");
  const tRoster = useTranslations("admin.schedule.roster");
  const tCommon = useTranslations("admin.schedule.common");
  const tErrors = useTranslations("admin.schedule.errors");
  const tCalendar = useTranslations("admin.schedule.calendar");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { data, timezone, canEdit } = useRoster();
  const changeReason = useChangeReason(canEdit);
  const entries = data.entries.filter((entry) => entry.date === date);
  const nameOf = (userId: string) =>
    data.people.find((person) => person.userId === userId)?.name ?? "";
  const range = (entry: (typeof entries)[number]) =>
    tRoster("cell.range", {
      start: localPartsOf(entry.startAt, timezone).time,
      end: localPartsOf(entry.endAt, timezone).time,
    });
  const removable = entries.filter((entry) => entry.deletable);
  const skipped = entries.filter((entry) => !entry.deletable);

  const remove = useRemoveScheduleDayEntriesMutation(
    session.client,
    useMutationFeedback({
      success: (result) =>
        t("feedback", {
          count: result.removeScheduleDayEntries.deletedIds.length,
        }),
      error: (error) => tErrors(scheduleErrorOf(error).code),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
        onClose();
      },
      onError: (error) => {
        changeReason.markFromError(error);
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("title", {
        date: tRoster("dateTitle", {
          date: monthDayOf(date),
          weekday: tCalendar(`weekdays.${String(weekdayOf(date))}`),
        }),
      })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={remove.isPending || removable.length === 0}
            onClick={() => {
              const reason = changeReason.take();
              if (reason !== null) {
                remove.mutate({
                  input: { ...reason, orgId: data.orgId, date },
                });
              }
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        <Typography variant="body2">
          {removable.length === 0 ? t("empty") : t("intro")}
        </Typography>
        {removable.length > 0 && (
          <Table
            size="small"
            columns={[
              {
                key: "person",
                header: t("columns.person"),
                render: (row) => row.person,
              },
              {
                key: "time",
                header: t("columns.time"),
                render: (row) => row.time,
              },
            ]}
            rows={removable.map((entry) => ({
              id: entry.id,
              person: nameOf(entry.userId),
              time: range(entry),
            }))}
            getRowKey={(row) => row.id}
          />
        )}
        {skipped.length > 0 && (
          <Alert severity="warning">
            {t("skipped", {
              count: skipped.length,
              list: skipped
                .map((entry) => `${nameOf(entry.userId)} ${range(entry)}`)
                .join("、"),
            })}
          </Alert>
        )}
        {removable.length > 0 && changeReason.fields}
        <Typography variant="caption" color="text.secondary">
          {t("specialDayHint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
