import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type SidebarBadgeSettingItemFragment,
  type UpdateSidebarBadgeSettingMutation,
  useUpdateSidebarBadgeSettingMutation,
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

import {
  NOTIFICATION_AUDIENCE_FIELDS,
  NOTIFICATION_AUDIENCE_ORG_SOURCES,
} from "./notification-audience";
import { requiresAudience } from "./sidebar-badge-audience";
import {
  type SidebarBadgeSettingsErrorCode,
  sidebarBadgeSettingsErrorOf,
} from "./sidebar-badge-settings-error";

export interface EditSidebarBadgeDialogProps {
  setting: SidebarBadgeSettingItemFragment;
  onClose: () => void;
  /** 儲存成功(之後關閉) */
  onSaved: () => void;
}

const firstField = NOTIFICATION_AUDIENCE_FIELDS[0] ?? "role";

/** 程式預設沒有要求權限時,從一列空的「角色」條件開始(最常見的調整是指定角色)。 */
const EMPTY_ROLE_AUDIENCE = {
  mode: "match",
  filter: {
    op: "AND",
    children: [
      { field: "role", cond: "in", value: { kind: "static", values: [] } },
    ],
  },
};

/** 起始條件:調整過的那一份;沒調整時從程式預設開始(要求權限的 = 持有那條權限,否則空的條件)。 */
const initialDraftOf = (
  setting: SidebarBadgeSettingItemFragment,
): AudienceDraft =>
  toAudienceDraft(
    setting.audience ??
      (setting.requires
        ? requiresAudience(setting.requires)
        : EMPTY_ROLE_AUDIENCE),
    firstField,
    NOTIFICATION_AUDIENCE_ORG_SOURCES,
  );

/**
 * 修改某個模組的側欄數字「誰看得到」:與通知收件人同一個 `AudiencePicker`(不能「所有人」、
 * 只有使用者 / 角色 / 權限)。綁了模組一律是前提,頂端資訊框說明。送出前本地驗證(空群組、沒挑值),
 * api 擋下的 `AUDIENCE_INVALID` / `OUT_OF_TENANT` 依 `path` 標回條件列,其餘錯誤顯示在對話框內。
 */
export const EditSidebarBadgeDialog = ({
  setting,
  onClose,
  onSaved,
}: EditSidebarBadgeDialogProps) => {
  const t = useTranslations("admin.sidebarBadgeSettings");
  const tErrors = useTranslations("admin.sidebarBadgeSettings.errors");
  const tPicker = useTranslations("admin.audiencePicker");
  const { session } = useSession();
  // RW-04:有表單欄位的彈窗在手機(< sm)全螢幕
  const isMobile = useBreakpointDown("sm");

  const [draft, setDraft] = useState<AudienceDraft>(() =>
    initialDraftOf(setting),
  );
  const [issues, setIssues] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [errorCode, setErrorCode] =
    useState<SidebarBadgeSettingsErrorCode | null>(null);

  const update = useUpdateSidebarBadgeSettingMutation(
    session.client,
    useMutationFeedback<UpdateSidebarBadgeSettingMutation>({
      success: t("feedback.saveSuccess"),
      // 失敗就地顯示在彈窗裡(條件列或對話框底部),不再跳提示
      error: () => null,
      onSuccess: onSaved,
      onError: (error) => {
        const parsed = sidebarBadgeSettingsErrorOf(error);
        if (parsed.path === undefined) {
          setErrorCode(parsed.code);
          return;
        }
        const location = audienceIssueFromPath(parsed.path);
        setIssues(
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

  const save = () => {
    setErrorCode(null);
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
    update.mutate({
      input: { moduleKey: setting.moduleKey, audience: toAudienceJson(draft) },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="md"
      title={t("edit.title", { name: setting.moduleName })}
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
          {t("edit.hint", { name: setting.moduleName })}
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
          <Typography variant="body2" color="error" role="alert">
            {tErrors(errorCode)}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
};
