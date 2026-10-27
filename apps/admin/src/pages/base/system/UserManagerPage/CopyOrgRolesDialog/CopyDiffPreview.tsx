import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { CopyUserOrgRolesResult } from "../user-manager-types";
import { hasCopyChanges } from "./useCopyOrgRoles";

export interface CopyDiffPreviewProps {
  hasTarget: boolean;
  isLoading: boolean;
  /** 預覽失敗:原因由彈窗的錯誤列顯示,這裡不再顯示「計算中」 */
  hasFailed: boolean;
  /** 目前這組「目標 × 方式」的預覽;還沒回來是 null */
  result: CopyUserOrgRolesResult | null;
}

type RoleRef = CopyUserOrgRolesResult["roles"]["added"][number];

/**
 * 複製組織與角色的預覽區:組織 / 角色各列新增 / 移除 / 保留(角色附擁有組織),
 * 沒有差異時一句「已符合」,範圍外角色會照樣保留時多一行提示,擋下的原因逐條列出。
 */
export const CopyDiffPreview = ({
  hasTarget,
  isLoading,
  hasFailed,
  result,
}: CopyDiffPreviewProps) => {
  const t = useTranslations("admin.userManager.copyOrgRoles");

  if (!hasTarget) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("pickTarget")}
      </Typography>
    );
  }
  if (hasFailed && !isLoading) {
    return null;
  }
  if (isLoading || result === null) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("loading")}
      </Typography>
    );
  }

  const roleLabel = (role: RoleRef) => {
    const org = role.ownerOrgName ?? null;
    return org === null
      ? role.name
      : t("roleWithOrg", { role: role.name, org });
  };
  const joined = (labels: string[]) =>
    labels.length === 0 ? t("none") : labels.join("、");
  const itemNameOf = (blocker: CopyUserOrgRolesResult["blockers"][number]) => {
    const roles = [...result.roles.added, ...result.roles.removed];
    const role = roles.find((item) => item.id === blocker.roleId);
    const org = result.orgs.removed.find((item) => item.id === blocker.orgId);
    return role?.name ?? org?.name ?? blocker.roleId ?? blocker.orgId ?? "";
  };

  const sections = [
    {
      key: "orgs",
      title: t("orgs"),
      rows: [
        ["added", joined(result.orgs.added.map((org) => org.name))],
        ["removed", joined(result.orgs.removed.map((org) => org.name))],
        ["kept", joined(result.orgs.kept.map((org) => org.name))],
      ],
    },
    {
      key: "roles",
      title: t("roles"),
      rows: [
        ["added", joined(result.roles.added.map((role) => roleLabel(role)))],
        [
          "removed",
          joined(result.roles.removed.map((role) => roleLabel(role))),
        ],
        ["kept", joined(result.roles.kept.map((role) => roleLabel(role)))],
      ],
    },
  ] as const;

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{t("preview")}</Typography>
      {hasCopyChanges(result) ? (
        sections.map((section) => (
          <Stack key={section.key} spacing={0.25}>
            <Typography variant="body2" color="textPrimary">
              {section.title}
            </Typography>
            {section.rows.map(([kind, text]) => (
              <Typography key={kind} variant="caption" color="textSecondary">
                {t(kind, { items: text })}
              </Typography>
            ))}
          </Stack>
        ))
      ) : (
        <Typography variant="body2" color="textSecondary">
          {t("noChanges")}
        </Typography>
      )}
      {result.outOfScopeKept && (
        <Alert severity="info">{t("outOfScopeKept")}</Alert>
      )}
      {result.blockers.length > 0 && (
        <Alert severity="error">
          <Stack spacing={0.5}>
            <Typography variant="body2">{t("blocked")}</Typography>
            {result.blockers.map((blocker) => (
              <Typography
                key={`${blocker.code}:${blocker.roleId ?? blocker.orgId ?? ""}`}
                variant="body2"
              >
                {t(`blockers.${blocker.code}`, { item: itemNameOf(blocker) })}
              </Typography>
            ))}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
};
