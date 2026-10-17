import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type NotificationSettingItemFragment,
  type UpdateNotificationSettingMutation,
  useUpdateNotificationSettingMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
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

import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";
import {
  type NotificationSettingsErrorCode,
  notificationSettingsErrorOf,
} from "./notification-settings-error";
import { useOrgScopeText } from "./useOrgScopeText";

export interface EditRecipientsDialogProps {
  setting: NotificationSettingItemFragment;
  onClose: () => void;
  onSaved: () => void;
}

const firstField = NOTIFICATION_AUDIENCE_FIELDS[0] ?? "role";

/**
 * 編輯收件人(Figma BS-09b `289:86572`):頂端說明組織範圍(類型宣告、不能改),下面是 `AudiencePicker`
 * (不允許「所有人」、沒有所屬組織欄)。[儲存] 前先做本地驗證(空群組、沒挑值),api 擋下的
 * `INVALID_AUDIENCE` / `OUT_OF_TENANT` 依 `path` 標回出錯的那一列;其餘錯誤顯示在對話框裡。
 */
export const EditRecipientsDialog = ({
  setting,
  onClose,
  onSaved,
}: EditRecipientsDialogProps) => {
  const t = useTranslations("admin.notificationSettings");
  const tErrors = useTranslations("admin.notificationSettings.errors");
  const tPicker = useTranslations("admin.audiencePicker");
  const { session } = useSession();
  const typeName = useNotificationTypeName();
  const orgScopeText = useOrgScopeText();
  const [draft, setDraft] = useState<AudienceDraft>(() =>
    toAudienceDraft(
      setting.audience,
      firstField,
      NOTIFICATION_AUDIENCE_ORG_SOURCES,
    ),
  );
  const [issues, setIssues] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [errorCode, setErrorCode] =
    useState<NotificationSettingsErrorCode | null>(null);

  const update = useUpdateNotificationSettingMutation(
    session.client,
    useMutationFeedback<UpdateNotificationSettingMutation>({
      success: t("feedback.saveSuccess"),
      // 失敗一律就地顯示在開著的彈窗裡(條件列或對話框底部),不再跳提示,免得同一句出現兩次
      error: () => null,
      onSuccess: onSaved,
      onError: (error) => {
        const parsed = notificationSettingsErrorOf(error);
        if (parsed.path !== undefined) {
          const location = audienceIssueFromPath(parsed.path);
          setIssues(
            new Map([
              [
                audienceIssueKey(location.childPath, location.target),
                tErrors(parsed.code),
              ],
            ]),
          );
          return;
        }
        setErrorCode(parsed.code);
      },
    }),
  );

  const save = () => {
    const problems = validateAudienceDraft(draft);
    if (problems.length > 0) {
      setIssues(
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
    setErrorCode(null);
    update.mutate({
      input: { type: setting.type, audience: toAudienceJson(draft) },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      title={t("edit.title", { name: typeName(setting.type, setting.name) })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("edit.cancel")}
          </Button>
          <Button disabled={update.isPending} onClick={save}>
            {t("edit.save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Alert severity="info">
          {t("edit.scopeHint", { scope: orgScopeText(setting.orgScope) })}
        </Alert>
        <AudiencePicker
          title={t("edit.audienceTitle")}
          isTitleHidden
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setIssues(new Map());
          }}
          allowAll={false}
          fields={NOTIFICATION_AUDIENCE_FIELDS}
          orgSources={NOTIFICATION_AUDIENCE_ORG_SOURCES}
          issues={issues}
        />
        {errorCode !== null && (
          <Typography variant="body2" color="error.main" role="alert">
            {tErrors(errorCode)}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
};
