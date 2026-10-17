import { useTranslations } from "use-intl";

import { HISTORY_REASONS } from "@repo/domain/workflow";
import type { WorkflowInstanceFieldsFragment } from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTemporalText } from "@/hooks/base/useTemporalText";
import { adminErrorText } from "@/lib/base/errors";

/** 不給使用者看的內部事件(寄信標記、重試推進的紀錄)。 */
const HIDDEN_KINDS = new Set(["notified", "advance_retried"]);

/** 跳過 / 自動通過帶原因(時間軸寫出是哪一項成立);認得的原因用 `reasons.*`,其他照事件種類。 */
const REASON_TEXT_KEYS: ReadonlySet<string> = new Set(HISTORY_REASONS);

type HistoryEvent = WorkflowInstanceFieldsFragment["history"][number];

/** B5 自動通過被守門擋下(`auto_approve_blocked`):依哪一種自動通過沒成立選文案。 */
const BLOCKED_KIND = "auto_approve_blocked";

const BLOCKED_REASONS: ReadonlySet<string> = new Set([
  "auto_applicant",
  "auto_prior_approver",
]);

const textKeyOf = (event: HistoryEvent): string => {
  const reason = event.reason ?? null;
  if (event.kind === BLOCKED_KIND) {
    return reason !== null && BLOCKED_REASONS.has(reason)
      ? `autoApproveBlocked.${reason}`
      : `kinds.${event.kind}`;
  }
  return reason !== null && REASON_TEXT_KEYS.has(reason)
    ? `reasons.${reason}`
    : `kinds.${event.kind}`;
};

export interface ApprovalTimelineProps {
  instance: WorkflowInstanceFieldsFragment;
}

/**
 * 審核時間軸(Spec 6b §8 零件 `<ApprovalTimeline>`):實例 `history` 依時間列出 ——
 * 送出、進關、跳過(寫出是「申請人屬於指定的組織」還是「符合跳過條件」)、派任、核准 / 駁回 / 退回(含理由;
 * B5 自動通過寫出原因;自動通過被守門擋下寫出專案文案)、阻擋 / 解除、改派、撤回、完成。
 */
export const ApprovalTimeline = ({ instance }: ApprovalTimelineProps) => {
  const t = useTranslations("admin.approval.timeline");
  const tRoot = useTranslations();
  const temporalText = useTemporalText();
  // 擋下的專案文案沿用 `admin.lifecycle.<碼>`;專案沒有文案時用中性的通用句
  const blockedMessage = (code: string | null | undefined): string =>
    adminErrorText(
      { code: "BLOCKED_GENERIC", ...(code != null && { projectReason: code }) },
      () => t("autoApproveBlockedGeneric"),
      tRoot,
    );
  const stepName = (stepKey: string | null | undefined): string =>
    instance.steps.find((step) => step.stepKey === stepKey)?.name ??
    stepKey ??
    "";
  const events = instance.history.filter(
    (event) => !HIDDEN_KINDS.has(event.kind),
  );

  return (
    <Stack spacing={1} component="section" aria-label={t("region")}>
      <Typography variant="subtitle2" component="h3">
        {t("title")}
      </Typography>
      <Stack
        component="ol"
        spacing={0.75}
        sx={{ listStyle: "none", m: 0, p: 0 }}
      >
        {events.map((event, index) => (
          <li key={`${event.at}-${event.kind}-${String(index)}`}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "baseline", flexWrap: "wrap" }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ minWidth: 132 }}
              >
                {temporalText(event.at, "datetime")}
              </Typography>
              <Typography variant="body2">
                {t(textKeyOf(event), {
                  step: stepName(event.stepKey),
                  user: event.user?.name ?? "—",
                  toUser: event.toUser?.name ?? "—",
                  message: blockedMessage(event.code),
                })}
              </Typography>
              {event.comment !== null &&
                event.comment !== undefined &&
                event.comment !== "" && (
                  <Typography variant="body2" color="text.secondary">
                    {t("comment", { comment: event.comment })}
                  </Typography>
                )}
            </Stack>
          </li>
        ))}
      </Stack>
    </Stack>
  );
};
