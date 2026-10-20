import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type NotificationSettingItemFragment,
  NotificationSettingPart,
  type ResetNotificationSettingMutation,
  type ResetNotificationSettingMutationVariables,
  type UpdateNotificationSettingInput,
  type UpdateNotificationSettingMutation,
  useResetNotificationSettingMutation,
  useUpdateNotificationSettingMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { AudiencePicker } from "@/components/base/AudiencePicker/AudiencePicker";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type AudienceDraft,
  audienceIssueFromPath,
  audienceIssueKey,
  toAudienceDraft,
  toAudienceJson,
  validateAudienceDraft,
} from "@/lib/base/audience-draft";
import { useNotificationTypeName } from "@/lib/base/notification-type-name";

import { ScheduleEditor } from "./ScheduleEditor";
import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";
import {
  type ScheduleDraft,
  type ScheduleIssues,
  toScheduleDraft,
  toScheduleInput,
  validateScheduleDraft,
} from "./notification-schedule";
import {
  type NotificationSettingsErrorCode,
  notificationSettingsErrorOf,
} from "./notification-settings-error";
import { useOrgScopeText } from "./useOrgScopeText";

export interface EditNotificationSettingDialogProps {
  setting: NotificationSettingItemFragment;
  onClose: () => void;
  /** 儲存成功(之後關閉) */
  onSaved: () => void;
  /** 某一塊還原預設成功(對話框仍開著,清單要重抓) */
  onPartReset: () => void;
}

const firstField = NOTIFICATION_AUDIENCE_FIELDS[0] ?? "role";

const audienceDraftOf = (
  audience: Record<string, unknown> | null | undefined,
): AudienceDraft =>
  toAudienceDraft(
    audience ?? { mode: "match" },
    firstField,
    NOTIFICATION_AUDIENCE_ORG_SOURCES,
  );

/** 一塊(收件人 / 提醒時間):標題列帶自己的 [還原預設]。 */
const Section = ({
  title,
  resetLabel,
  canReset,
  onReset,
  children,
}: {
  title: string;
  resetLabel: string;
  canReset: boolean;
  onReset: () => void;
  children: ReactNode;
}) => (
  <Stack spacing={1.5} component="section" aria-label={title}>
    <Stack direction="row" sx={{ alignItems: "center" }}>
      <Typography variant="subtitle2" component="h3" sx={{ flex: 1 }}>
        {title}
      </Typography>
      <Button
        variant="text"
        size="small"
        disabled={!canReset}
        onClick={onReset}
      >
        {resetLabel}
      </Button>
    </Stack>
    {children}
  </Stack>
);

/**
 * 編輯通知設定:有幾塊顯示幾塊 ——「收件人」(負責人提醒才有)、「提醒時間」(宣告了可調時間才有),
 * 兩塊各自有 [還原預設](調整過的立即還原、清單重抓;只改了草稿的就地改回預設)。
 * [儲存] 只送碰過的那幾塊(GQL-06);送出前先做本地驗證(收件人的空群組 / 沒挑值、提醒時間的範圍),
 * api 擋下的 `AUDIENCE_INVALID` / `OUT_OF_TENANT` 依 `path` 標回條件列、`SCHEDULE_INVALID` 標回那一格,
 * 其餘錯誤顯示在對話框裡。
 */
export const EditNotificationSettingDialog = ({
  setting,
  onClose,
  onSaved,
  onPartReset,
}: EditNotificationSettingDialogProps) => {
  const t = useTranslations("admin.notificationSettings");
  const tErrors = useTranslations("admin.notificationSettings.errors");
  const tPicker = useTranslations("admin.audiencePicker");
  const { session } = useSession();
  // RW-04:有表單欄位的彈窗在手機(< sm)全螢幕
  const isMobile = useBreakpointDown("sm");
  const typeName = useNotificationTypeName();
  const orgScopeText = useOrgScopeText();

  const hasAudience = setting.category === "responsible";
  const defaultSchedule = setting.defaultSchedule ?? null;

  const [audienceDraft, setAudienceDraft] = useState<AudienceDraft>(() =>
    audienceDraftOf(setting.audience),
  );
  const [audienceTouched, setAudienceTouched] = useState(false);
  const [audienceIsDefault, setAudienceIsDefault] = useState(setting.isDefault);
  const [audienceIssues, setAudienceIssues] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());

  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(
    () =>
      setting.schedule === null || setting.schedule === undefined
        ? null
        : toScheduleDraft(setting.schedule),
  );
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [scheduleIsDefault, setScheduleIsDefault] = useState(
    setting.isScheduleDefault,
  );
  const [scheduleIssues, setScheduleIssues] = useState<ScheduleIssues>(
    () => new Map(),
  );

  const [errorCode, setErrorCode] =
    useState<NotificationSettingsErrorCode | null>(null);

  const restoreAudienceDraft = () => {
    setAudienceDraft(audienceDraftOf(setting.defaultAudience));
    setAudienceTouched(false);
    setAudienceIssues(new Map());
  };

  const restoreScheduleDraft = () => {
    setScheduleDraft(
      defaultSchedule === null ? null : toScheduleDraft(defaultSchedule),
    );
    setScheduleTouched(false);
    setScheduleIssues(new Map());
  };

  const update = useUpdateNotificationSettingMutation(
    session.client,
    useMutationFeedback<UpdateNotificationSettingMutation>({
      success: t("feedback.saveSuccess"),
      // 失敗一律就地顯示在開著的彈窗裡(條件列、那一格或對話框底部),不再跳提示,免得同一句出現兩次
      error: () => null,
      onSuccess: onSaved,
      onError: (error) => {
        const parsed = notificationSettingsErrorOf(error);
        if (parsed.path === undefined) {
          setErrorCode(parsed.code);
          return;
        }
        if (parsed.code === "SCHEDULE_INVALID") {
          setScheduleIssues(new Map([[parsed.path, "invalid"]]));
          return;
        }
        const location = audienceIssueFromPath(parsed.path);
        setAudienceIssues(
          new Map([
            [
              audienceIssueKey(location.childPath, location.target),
              tErrors(parsed.code),
            ],
          ]),
        );
      },
    }),
  );

  const resetPart = useResetNotificationSettingMutation(
    session.client,
    useMutationFeedback<
      ResetNotificationSettingMutation,
      ResetNotificationSettingMutationVariables
    >({
      success: t("feedback.resetSuccess"),
      error: () => null,
      onSuccess: (_data, variables) => {
        if (variables.input.part === NotificationSettingPart.Audience) {
          restoreAudienceDraft();
          setAudienceIsDefault(true);
        } else {
          restoreScheduleDraft();
          setScheduleIsDefault(true);
        }
        onPartReset();
      },
      onError: (error) => {
        setErrorCode(notificationSettingsErrorOf(error).code);
      },
    }),
  );

  const save = () => {
    setErrorCode(null);
    const input: UpdateNotificationSettingInput = { type: setting.type };
    if (hasAudience && audienceTouched) {
      const problems = validateAudienceDraft(audienceDraft);
      if (problems.length > 0) {
        setAudienceIssues(
          new Map(
            problems.map((problem) => [
              audienceIssueKey(problem.childPath, problem.target),
              problem.target === "group"
                ? tPicker("emptyGroup")
                : tPicker("emptyValue"),
            ]),
          ),
        );
        return;
      }
      input.audience = toAudienceJson(audienceDraft);
    }
    if (scheduleDraft !== null && scheduleTouched) {
      const problems = validateScheduleDraft(scheduleDraft);
      if (problems.size > 0) {
        setScheduleIssues(problems);
        return;
      }
      input.schedule = toScheduleInput(scheduleDraft);
    }
    if (input.audience === undefined && input.schedule === undefined) {
      // 什麼都沒改:不必送(api 會回 NOTHING_TO_UPDATE)
      onClose();
      return;
    }
    update.mutate({ input });
  };

  const sendPartReset = (part: NotificationSettingPart) => {
    setErrorCode(null);
    resetPart.mutate({ input: { type: setting.type, part } });
  };

  let titlePart = "audience";
  if (scheduleDraft !== null) {
    titlePart = hasAudience ? "both" : "schedule";
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="md"
      title={t("edit.title", {
        part: titlePart,
        name: typeName(setting.type, setting.name),
      })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("edit.cancel")}
          </Button>
          <Button
            disabled={update.isPending || resetPart.isPending}
            onClick={save}
          >
            {t("edit.save")}
          </Button>
        </>
      }
    >
      <Stack spacing={3} sx={{ pt: 1 }}>
        {hasAudience && (
          <Section
            title={t("edit.audienceTitle")}
            resetLabel={t("edit.resetPart")}
            canReset={
              !resetPart.isPending && (!audienceIsDefault || audienceTouched)
            }
            onReset={() => {
              if (audienceIsDefault) {
                restoreAudienceDraft();
                return;
              }
              sendPartReset(NotificationSettingPart.Audience);
            }}
          >
            {setting.orgScope && (
              <Alert severity="info">
                {t("edit.scopeHint", {
                  scope: orgScopeText(setting.orgScope),
                })}
              </Alert>
            )}
            <AudiencePicker
              title={t("edit.audienceTitle")}
              isTitleHidden
              value={audienceDraft}
              onChange={(next) => {
                setAudienceDraft(next);
                setAudienceTouched(true);
                setAudienceIssues(new Map());
              }}
              allowAll={false}
              fields={NOTIFICATION_AUDIENCE_FIELDS}
              orgSources={NOTIFICATION_AUDIENCE_ORG_SOURCES}
              issues={audienceIssues}
            />
          </Section>
        )}
        {scheduleDraft !== null && (
          <Section
            title={t("edit.scheduleTitle")}
            resetLabel={t("edit.resetPart")}
            canReset={
              !resetPart.isPending && (!scheduleIsDefault || scheduleTouched)
            }
            onReset={() => {
              if (scheduleIsDefault) {
                restoreScheduleDraft();
                return;
              }
              sendPartReset(NotificationSettingPart.Schedule);
            }}
          >
            <ScheduleEditor
              value={scheduleDraft}
              issues={scheduleIssues}
              onChange={(next) => {
                setScheduleDraft(next);
                setScheduleTouched(true);
                setScheduleIssues(new Map());
              }}
            />
          </Section>
        )}
        {errorCode !== null && (
          <Typography variant="body2" color="error.main" role="alert">
            {tErrors(errorCode)}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
};
