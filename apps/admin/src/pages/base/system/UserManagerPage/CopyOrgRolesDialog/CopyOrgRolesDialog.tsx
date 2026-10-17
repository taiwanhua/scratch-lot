import { useTranslations } from "use-intl";

import { CopyUserOrgRolesMode } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { UserPicker } from "@/components/base/UserPicker/UserPicker";
import { useMe } from "@/hooks/base/useMe";

import type { UserRow } from "../user-manager-types";
import { CopyDiffPreview } from "./CopyDiffPreview";
import { useCopyOrgRoles } from "./useCopyOrgRoles";

export interface CopyOrgRolesDialogProps {
  /** 來源使用者(列動作所在的那一列,唯讀) */
  source: UserRow;
  onClose: () => void;
  /** 複製成功:頁面重查清單與目標那一筆(DATA-04),並關掉彈窗 */
  onCopied: (targetId: string) => void;
}

/**
 * 複製組織與角色:來源(唯讀)→ 目標(搜整個管理範圍、排除來源本人、停用的也能選)→
 * 合併 / 取代 → 預覽差異 → 確認。選目標或切方式就重新預覽;
 * 預覽沒完成、有擋下的原因或沒有差異時確認鈕停用;失敗留在彈窗顯示原因。
 */
export const CopyOrgRolesDialog = ({
  source,
  onClose,
  onCopied,
}: CopyOrgRolesDialogProps) => {
  const t = useTranslations("admin.userManager.copyOrgRoles");
  const tErrors = useTranslations("admin.userManager.errors");
  const flow = useCopyOrgRoles(source, onCopied);
  const me = useMe();
  /** 來源本人、以及操作者自己(取代會把自己的管理角色解除,api 也擋)都不能當目標 */
  const excludedIds = [source.id, me.data?.me.id].filter(
    (id): id is string => id !== undefined,
  );

  const options = [
    {
      value: CopyUserOrgRolesMode.Merge,
      label: t("merge.label"),
      hint: t("merge.hint"),
    },
    {
      value: CopyUserOrgRolesMode.Replace,
      label: t("replace.label"),
      hint: t("replace.hint"),
    },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!flow.canConfirm} onClick={flow.confirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Stack spacing={0.25}>
          <Typography variant="caption" color="text.secondary">
            {t("source")}
          </Typography>
          <Typography variant="body2">
            {t("sourceValue", { name: source.name, account: source.account })}
          </Typography>
        </Stack>

        <UserPicker
          label={t("target")}
          value={flow.target}
          onChange={flow.selectTarget}
          allowDisabled
          excludeUserIds={excludedIds}
          helperText={t("targetHelper")}
        />

        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{t("mode")}</Typography>
          <RadioGroup
            value={flow.mode}
            onChange={(event) => {
              flow.selectMode(event.target.value as CopyUserOrgRolesMode);
            }}
          >
            {options.map((option) => (
              <FormControlLabel
                key={option.value}
                value={option.value}
                control={<Radio />}
                sx={{ alignItems: "flex-start", mb: 1 }}
                label={
                  <Stack spacing={0.25} sx={{ pt: 1 }}>
                    <Typography variant="body2" color="text.primary">
                      {option.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.hint}
                    </Typography>
                  </Stack>
                }
              />
            ))}
          </RadioGroup>
          <Typography variant="caption" color="text.secondary">
            {t("oneOff")}
          </Typography>
        </Stack>

        <CopyDiffPreview
          hasTarget={flow.target !== null}
          isLoading={flow.isPreviewing}
          hasFailed={flow.hasPreviewFailed}
          result={flow.preview}
        />

        {flow.errorCode !== null && (
          <Alert severity="error">{tErrors(flow.errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
