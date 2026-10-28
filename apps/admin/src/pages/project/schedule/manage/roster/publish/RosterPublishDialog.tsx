import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import {
  usePublishScheduleMutation,
  useScheduleCheckQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import { scheduleErrorKey } from "../../../schedule-error";
import { CheckItemList } from "../check-panel/CheckItemList";
import { publishBlockedReasonOf } from "../check-panel/check-errors";
import {
  checkTargetOf,
  useRosterCheck,
} from "../check-panel/roster-check-context";
import { ROSTER_QUERY_ROOT } from "../roster-context";

export interface RosterPublishDialogProps {
  onClose: () => void;
}

/**
 * 發布確認視窗(規格 14.5「發布」):打開時用**最新的生效設定**重新檢查整月,依結果三種之一 ——
 *
 * - SC-15a 全部符合:[取消] [發布]
 * - SC-15c 只有提醒:列出提醒(每列 [查看]:關閉視窗、捲到那一格並閃爍),[取消] [仍要發布]
 * - SC-15d 有違反限制:「不能發布」,列出違反(限制在前、提醒在後),[關閉] [發布](停用)
 *
 * 發布成功 → 已發布(SC-15b),工具列的 [自動排班] [發布] 不再顯示;api 通知被排到的人。
 */
export const RosterPublishDialog = ({ onClose }: RosterPublishDialogProps) => {
  const t = useTranslations("admin.schedule.roster.publish");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const { data, month, scrollToCell } = useRosterCheck();
  const variables = {
    input: { month, ...(data === undefined ? {} : { orgId: data.orgId }) },
  };
  // 每次打開都重查(不吃面板的快取):用發布當下的設定
  const check = useScheduleCheckQuery(session.client, variables, {
    queryKey: [...ROSTER_QUERY_ROOT, "check", "publish", variables],
    staleTime: 0,
    gcTime: 0,
  });
  const result = check.isFetching ? undefined : check.data?.scheduleCheck;
  const [, monthNumber = ""] = month.split("-");
  const monthLabel = Number(monthNumber);
  const scheduledCount = new Set(data?.entries.map((entry) => entry.userId))
    .size;

  const errorText = (cause: unknown) => {
    switch (publishBlockedReasonOf(cause)) {
      case "HAS_LIMIT_VIOLATIONS": {
        return t("errors.HAS_LIMIT_VIOLATIONS");
      }
      case "ALREADY_PUBLISHED": {
        return t("errors.ALREADY_PUBLISHED");
      }
      case "CHANGED_DURING_PUBLISH": {
        return t("errors.CHANGED_DURING_PUBLISH");
      }
      case "AUTO_RUN_IN_PROGRESS": {
        return t("errors.AUTO_RUN_IN_PROGRESS");
      }
      case null: {
        return tErrors(scheduleErrorKey(cause));
      }
    }
  };
  const publish = usePublishScheduleMutation(
    session.client,
    useMutationFeedback({
      success: (payload) =>
        t("feedback", {
          month: monthLabel,
          count: payload.publishSchedule.notifiedCount,
        }),
      error: errorText,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_ROOT });
        onClose();
      },
      onError: (cause) => {
        if (publishBlockedReasonOf(cause) === "HAS_LIMIT_VIOLATIONS") {
          void check.refetch();
        }
      },
    }),
  );

  const isBlocked = (result?.limitCount ?? 0) > 0;
  const hasReminders = !isBlocked && (result?.reminderCount ?? 0) > 0;
  const title = isBlocked
    ? t("blockedTitle")
    : t("title", { month: monthLabel });
  const intro = (() => {
    if (result === undefined) {
      return null;
    }
    if (isBlocked) {
      return t("blocked", { count: result.limitCount });
    }
    return hasReminders
      ? t("reminders", { count: result.reminderCount })
      : t("allClear", { count: scheduledCount });
  })();

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={title}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {isBlocked ? t("close") : t("cancel")}
          </Button>
          <Button
            disabled={result === undefined || isBlocked || publish.isPending}
            onClick={() => {
              publish.mutate({
                input: {
                  month,
                  ...(data === undefined ? {} : { orgId: data.orgId }),
                },
              });
            }}
          >
            {hasReminders ? t("confirmAnyway") : t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5}>
        {result === undefined ? (
          <Stack sx={{ alignItems: "center", py: 2 }}>
            <CircularProgress size={24} aria-label={t("checking")} />
          </Stack>
        ) : (
          <Typography variant="body2" color="textSecondary">
            {intro}
          </Typography>
        )}
        {result !== undefined && result.items.length > 0 && (
          <>
            <CheckItemList
              items={result.items}
              data={data}
              onView={(item) => {
                onClose();
                scrollToCell(checkTargetOf(item, timezone));
              }}
            />
            <Typography variant="caption" color="textSecondary">
              {t("footnote")}
            </Typography>
          </>
        )}
      </Stack>
    </Dialog>
  );
};
