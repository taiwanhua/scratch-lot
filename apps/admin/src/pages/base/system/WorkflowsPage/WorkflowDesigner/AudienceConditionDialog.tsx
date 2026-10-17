import { useState } from "react";
import { useTranslations } from "use-intl";

import type { AudienceField } from "@repo/domain/audience";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";

import { AudiencePicker } from "@/components/base/AudiencePicker/AudiencePicker";
import {
  type AudienceDraft,
  type AudienceOrgSourceOption,
  audienceIssueKey,
  toAudienceJson,
  validateAudienceDraft,
} from "@/lib/base/audience-draft";

import type { PeoplePurpose } from "./people-purpose";

export interface AudienceConditionDialogProps {
  /** 用途:審核者 / 知會對象 / 通知對象(只換標題) */
  purpose: PeoplePurpose;
  /** 標題後半:關卡名稱(整個流程的知會對象傳「整個流程」) */
  stepName: string;
  isShared: boolean;
  initial: AudienceDraft;
  fields: readonly AudienceField[];
  orgSources: readonly AudienceOrgSourceOption[];
  onCancel: () => void;
  onApply: (audience: Record<string, unknown>) => void;
}

/**
 * 人員條件對話框(《底座規格》3.3;Figma BS-02b 客製 / BS-02d 共用;審核者、知會對象、逾時通知對象共用):關卡面板放不下條件列,
 * 條件在這裡用 `AudiencePicker` 編輯;[套用] 才寫回關卡,[取消] 不動。
 * 共用流程頂端說明只能用「權限」與組織來源,欄位清單也只給這兩種(`SHARED_APPROVER_AUDIENCE_OPTIONS`)。
 * 套用前先做本地驗證(空群組、沒挑值),有問題就標在那一列、不關閉。
 */
export const AudienceConditionDialog = ({
  purpose,
  stepName,
  isShared,
  initial,
  fields,
  orgSources,
  onCancel,
  onApply,
}: AudienceConditionDialogProps) => {
  const t = useTranslations("admin.workflows.assignee");
  const tPicker = useTranslations("admin.audiencePicker");
  const [draft, setDraft] = useState(initial);
  const [issues, setIssues] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  const apply = () => {
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
    onApply(toAudienceJson(draft));
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="md"
      title={
        isShared
          ? t(`purposes.${purpose}.dialogTitleShared`, { step: stepName })
          : t(`purposes.${purpose}.dialogTitle`, { step: stepName })
      }
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("dialogCancel")}
          </Button>
          <Button onClick={apply}>{t("dialogApply")}</Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {isShared && <Alert severity="warning">{t("sharedHint")}</Alert>}
        <AudiencePicker
          title={t(`purposes.${purpose}.audienceTitle`)}
          isTitleHidden
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setIssues(new Map());
          }}
          allowAll={false}
          fields={fields}
          orgSources={orgSources}
          issues={issues}
        />
      </Stack>
    </Dialog>
  );
};
