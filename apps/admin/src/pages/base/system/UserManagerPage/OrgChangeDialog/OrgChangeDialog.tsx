import { useState } from "react";
import { useTranslations } from "use-intl";

import { UserOrgRemovalPolicy } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { UserManagerErrorCode } from "../user-manager-error";
import type { SetUserOrgsResult } from "../user-manager-types";
import { UnqualifiedRoleList } from "./UnqualifiedRoleList";
import { revokedByPolicy } from "./unqualified-roles";

export interface OrgChangeDialogProps {
  userName: string;
  /** `setUserOrgs(dryRun: true)` 的結果:移除的組織 + 逐筆附原因的失去資格角色 */
  preview: SetUserOrgsResult;
  isSubmitting: boolean;
  errorCode: UserManagerErrorCode | null;
  onCancel: () => void;
  onConfirm: (policy: UserOrgRemovalPolicy) => void;
}

/**
 * 確認所屬組織變更(Figma 95:1252):移除所屬組織時必出。
 * 三檔對應 ADR-0003 的 `removalPolicy`,預設 (c)「解除所有因此失去資格的角色」;
 * 每一檔的說明直接列出該檔會解除哪些授予,受擁有者保護的那筆一律不會被解除。
 */
export const OrgChangeDialog = ({
  userName,
  preview,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: OrgChangeDialogProps) => {
  const t = useTranslations("admin.userManager.orgChange");
  const tErrors = useTranslations("admin.userManager.errors");
  const [policy, setPolicy] = useState<UserOrgRemovalPolicy>(
    UserOrgRemovalPolicy.RevokeAllUnqualified,
  );

  const formatRoles = (roles: SetUserOrgsResult["unqualifiedRoles"]) =>
    roles.length === 0
      ? t("noneAffected")
      : roles
          .map((role) =>
            t("roleWithOrg", {
              role: role.roleName,
              org: role.ownerOrgName ?? role.ownerOrgId ?? "",
            }),
          )
          .join("、");

  const options = [
    {
      value: UserOrgRemovalPolicy.KeepAll,
      label: t("keepAll.label"),
      hint: t("keepAll.hint"),
    },
    {
      value: UserOrgRemovalPolicy.RevokeOwnedByOrg,
      label: t("revokeOwned.label"),
      hint: t("revokeOwned.hint", {
        roles: formatRoles(
          revokedByPolicy(
            preview.unqualifiedRoles,
            UserOrgRemovalPolicy.RevokeOwnedByOrg,
          ),
        ),
      }),
    },
    {
      value: UserOrgRemovalPolicy.RevokeAllUnqualified,
      label: t("revokeAll.label"),
      hint: t("revokeAll.hint", {
        roles: formatRoles(
          revokedByPolicy(
            preview.unqualifiedRoles,
            UserOrgRemovalPolicy.RevokeAllUnqualified,
          ),
        ),
      }),
    },
  ];

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => {
              onConfirm(policy);
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="body2">
            {t("intro", { name: userName })}
          </Typography>
          <Typography variant="body2">
            {t("removed", {
              orgs: preview.removedOrgs.map((org) => org.name).join("、"),
            })}
          </Typography>
          <Typography variant="body2">{t("affected")}</Typography>
        </Stack>

        <UnqualifiedRoleList roles={preview.unqualifiedRoles} />

        <RadioGroup
          value={policy}
          onChange={(event) => {
            setPolicy(event.target.value as UserOrgRemovalPolicy);
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
                  <Typography variant="body2" color="textPrimary">
                    {option.label}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    {option.hint}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>

        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
