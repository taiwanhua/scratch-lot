import { useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { UserPicker } from "@/components/base/UserPicker/UserPicker";
import type { UserCandidate } from "@/components/base/UserPicker/useUserCandidates";

export interface AssignUserDialogProps {
  /** `reassign` = 把一個任務改派給別人;`add` = 對解析為空的關卡新增審核者 */
  mode: "reassign" | "add";
  stepName: string;
  /** 改派時:原承辦人 */
  fromName?: string;
  /** 不能選的人:申請人(除非 `allowsApplicant`)、已在本關的人 */
  applicantId: string | null;
  /** 這一關「申請人也是審核者時」= 照常審核:申請人可以選 */
  allowsApplicant: boolean;
  stepAssigneeIds: readonly string[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: (userId: string) => void;
}

/**
 * 改派 / 新增審核者跳窗:選一位啟用中、在本租戶的人;已在本關的人與申請人自己列出但不能選
 * (申請人在這一關設「照常審核」時可以選;api 也會擋:`ASSIGNEE_NOT_ELIGIBLE` / `ALREADY_IN_STEP`)。
 */
export const AssignUserDialog = ({
  mode,
  stepName,
  fromName,
  applicantId,
  allowsApplicant,
  stepAssigneeIds,
  isSubmitting,
  errorMessage,
  onCancel,
  onConfirm,
}: AssignUserDialogProps) => {
  const t = useTranslations("admin.workflows.blocked.assignDialog");
  const [picked, setPicked] = useState<UserCandidate | null>(null);

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t(mode === "reassign" ? "reassignTitle" : "addTitle", {
        step: stepName,
      })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            disabled={picked === null || isSubmitting}
            onClick={() => {
              if (picked !== null) {
                onConfirm(picked.id);
              }
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">
          {mode === "reassign"
            ? t("reassignBody", { from: fromName ?? "—" })
            : t("addBody")}
        </Typography>
        <UserPicker
          label={t("user")}
          value={picked}
          onChange={setPicked}
          disabledReasonOf={(user) => {
            if (user.id === applicantId && !allowsApplicant) {
              return t("isApplicant");
            }
            return stepAssigneeIds.includes(user.id) ? t("inStep") : null;
          }}
        />
        {errorMessage !== null && (
          <Alert severity="error">{errorMessage}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
