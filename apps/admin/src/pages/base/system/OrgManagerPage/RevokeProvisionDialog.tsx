import { useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type {
  OrgManagerErrorCode,
  OrgNotDeletableReason,
} from "./org-manager-error";
import type { OrgDetail } from "./org-manager-types";

export interface RevokeProvisionDialogProps {
  org: OrgDetail;
  /** 會被一併抹掉的擁有者帳號;沒有使用者清單權限時為 null(改顯示一句代稱) */
  ownerAccount: string | null;
  /** 會被一併抹掉的租戶管理員角色副本名稱;查不到時為 null */
  roleName: string | null;
  isSubmitting: boolean;
  errorCode: OrgManagerErrorCode | null;
  /** `PROVISION_NOT_REVOKABLE` 時 api 逐項回報為什麼撤銷不了 */
  reasons: readonly OrgNotDeletableReason[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 撤銷開通的確認彈窗(根組織專屬)。
 *
 * **比刪除更嚴格**:刪除是軟刪除、還原得回來,撤銷是硬刪除三筆資料(租戶頂層、擁有者帳號、
 * 租戶管理員副本),所以要**照打租戶名稱**才按得下去 —— 讓人在按之前先看清楚自己撤的是哪一個。
 * 前置檢查一樣不在前端預判(規則正本在 api 的 `OrgsService.orgContentReasons`),
 * 送出後收到 `PROVISION_NOT_REVOKABLE` 才把 `reasons` 攤成清單。
 */
export const RevokeProvisionDialog = ({
  org,
  ownerAccount,
  roleName,
  isSubmitting,
  errorCode,
  reasons,
  onCancel,
  onConfirm,
}: RevokeProvisionDialogProps) => {
  const t = useTranslations("admin.orgManager.revoke");
  const tForm = useTranslations("admin.orgManager.form");
  const tDelete = useTranslations("admin.orgManager.delete");
  const tErrors = useTranslations("admin.orgManager.errors");
  const [typedName, setTypedName] = useState("");

  const isBlocked = reasons.length > 0;
  const isConfirmed = typedName.trim() === org.name;

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      title={t("title", { name: org.name })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {isBlocked ? tDelete("close") : tForm("cancel")}
          </Button>
          {!isBlocked && (
            <Button
              color="error"
              disabled={isSubmitting || !isConfirmed}
              onClick={onConfirm}
            >
              {t("confirm")}
            </Button>
          )}
        </>
      }
    >
      <Stack spacing={2}>
        {isBlocked ? (
          <>
            <Typography variant="body2">{t("blocked")}</Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 3 }}>
              {reasons.map((reason) => (
                <Typography key={reason} component="li" variant="body2">
                  {tDelete(`reasons.${reason}`)}
                </Typography>
              ))}
            </Stack>
            <Alert severity="info">{t("blockedHint")}</Alert>
          </>
        ) : (
          <>
            <Typography variant="body2">{t("body")}</Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 3 }}>
              <Typography component="li" variant="body2">
                {t("targets.org", { name: org.name })}
              </Typography>
              <Typography component="li" variant="body2">
                {t("targets.owner", {
                  account: ownerAccount ?? t("unknownOwner"),
                })}
              </Typography>
              <Typography component="li" variant="body2">
                {t("targets.role", { name: roleName ?? t("unknownRole") })}
              </Typography>
            </Stack>
            <Alert severity="warning">{t("irreversible")}</Alert>
            <TextField
              label={t("confirmLabel", { name: org.name })}
              value={typedName}
              onChange={(event) => {
                setTypedName(event.target.value);
              }}
            />
          </>
        )}
        {errorCode !== null && !isBlocked && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
