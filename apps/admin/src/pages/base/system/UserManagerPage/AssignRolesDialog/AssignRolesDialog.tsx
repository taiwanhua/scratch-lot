import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { useOrgTreeQuery, useRolesQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Autocomplete } from "@repo/ui/autocomplete";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { isEligibleForRole, orgTrailIndex } from "@/lib/base/role-eligibility";
import { roleGroupNameOf, shouldGroupRoles } from "@/lib/base/role-options";

import type { UserManagerErrorCode } from "../user-manager-error";
import type { UserRow } from "../user-manager-types";
import { RoleOptionList } from "./RoleOptionList";
import {
  type RoleOption,
  buildRoleOptions,
  isRoleSelectable,
} from "./assignable-roles";

/**
 * 彈窗一次把候選角色抓齊(api 上限 100,`RolesInput`)。角色是治理資料、數量遠小於
 * 使用者,分頁在這個彈窗裡只會讓「勾一勾按儲存」變成跨頁操作。
 */
const ROLES_PAGE_SIZE = 100;

export interface AssignRolesDialogProps {
  user: UserRow;
  isSubmitting: boolean;
  errorCode: UserManagerErrorCode | null;
  onCancel: () => void;
  onConfirm: (roleIds: string[]) => void;
}

/**
 * 指派角色(Figma 86:245):全量覆蓋。
 *
 * 候選來自正式的 `roles` query(#211;第 3 段拿「操作者自己持有的角色」當清單的過渡
 * 做法退場)—— 範圍是**擁有組織在操作者管理範圍內**,與 api 的 `assignUserRoles`、
 * 角色頁的 `grantRoleUsers` 同一條判準(ADR-0003 / ADR-0005)。
 *
 * #261 的兩件事:
 * - **沒有授予資格的角色顯示但 disabled** 並就地說明(在此之前勾得下去,送出才吃到錯)
 * - 每列標角色名稱 + 擁有組織,跨租戶時依 `ownerOrg.tenantTop` 分組並可搜尋
 *
 * #307:選單改 `@repo/ui/autocomplete`(輸入即過濾、分組、不合格項灰掉並就地寫原因),
 * 原本「組織篩選 Select + 選單外搜尋框 + 一長串勾選列」三件組收斂成一個選擇器;
 * 選中的角色以 chip 顯示,下方保留一份**已選清單**講每一筆的狀態(組織外 / 已停用 /
 * 租戶副本 / 管理範圍外)—— 那些資訊放不進一行 chip,但取消勾選前必須看得到。
 */
export const AssignRolesDialog = ({
  user,
  isSubmitting,
  errorCode,
  onCancel,
  onConfirm,
}: AssignRolesDialogProps) => {
  const t = useTranslations("admin.userManager.assignRoles");
  const tErrors = useTranslations("admin.userManager.errors");
  const { session } = useSession();

  const rolesQuery = useRolesQuery(session.client, {
    input: { page: 1, pageSize: ROLES_PAGE_SIZE },
  });
  const orgTree = useOrgTreeQuery(session.client);
  const assignable = useMemo(
    () => rolesQuery.data?.roles.items ?? [],
    [rolesQuery.data],
  );
  const memberOrgIds = useMemo(
    () => user.orgs.map((org) => org.id),
    [user.orgs],
  );
  const options = useMemo(() => {
    const trails = orgTrailIndex(orgTree.data?.orgTree ?? []);
    return buildRoleOptions(assignable, user.roles, (ownerOrgId) =>
      isEligibleForRole(memberOrgIds, ownerOrgId, trails),
    );
  }, [assignable, user.roles, memberOrgIds, orgTree.data?.orgTree]);

  const [checkedIds, setCheckedIds] = useState<readonly string[]>(
    user.roles.map((role) => role.id),
  );

  const selected = options.filter((role) => checkedIds.includes(role.id));
  const groupBy = shouldGroupRoles(options)
    ? (role: RoleOption) => roleGroupNameOf(role, t("noTenant"))
    : undefined;

  /**
   * 選項的次文字(Figma 253:24)= 擁有組織 + 狀態標記。
   * 標記跟著選項走而不是只放在下方的已選清單 —— 「這一筆是租戶副本 / 已停用 / 組織外」
   * 是**決定要不要選它**時需要的資訊,選完才看到就太晚了。
   */
  const secondaryTextOf = (role: RoleOption) =>
    [
      t("ownerOrg", { org: role.ownerOrgName ?? role.ownerOrgId ?? "" }),
      ...(role.isOutOfScope ? [t("outOfScope")] : []),
      ...(role.enabled ? [] : [t("roleDisabled")]),
      ...(role.isTemplateCopy ? [t("templateCopy")] : []),
    ].join(" · ");

  /**
   * 不能選的原因。管理範圍外的既有授予**拔不掉也加不了**;已停用 / 不合格的
   * 只擋「新勾」—— 已持有的仍要能取消,不然停用的角色就永遠拔不掉了(#211 的邊界)。
   */
  const disabledReasonOf = (role: RoleOption) => {
    if (role.isOutOfReach) {
      return t("outOfReach");
    }
    if (!role.enabled) {
      return t("roleDisabled");
    }
    return t("notEligible", {
      org: role.ownerOrgName ?? role.ownerOrgId ?? "",
      name: user.name,
    });
  };

  /** 只送操作者可觸及的角色(觸及不到的既有授予由 api 原樣保留)。 */
  const handleConfirm = () => {
    const reachable = new Set(
      options.filter((role) => !role.isOutOfReach).map((role) => role.id),
    );
    onConfirm(checkedIds.filter((id) => reachable.has(id)));
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      title={t("title", { name: user.name })}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button disabled={isSubmitting} onClick={handleConfirm}>
            {t("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.75}>
        <Typography variant="caption" color="text.secondary">
          {t("hint", { name: user.name })}
        </Typography>

        <Autocomplete<RoleOption, true>
          multiple
          size="small"
          label={t("label")}
          placeholder={t("searchPlaceholder")}
          options={options}
          value={selected}
          noOptionsText={t("empty")}
          groupBy={groupBy}
          getOptionKey={(role) => role.id}
          getOptionLabel={(role) => role.name}
          getOptionSecondaryText={secondaryTextOf}
          getOptionDisabled={(role) =>
            !isRoleSelectable(role, checkedIds.includes(role.id))
          }
          getOptionDisabledReason={disabledReasonOf}
          onChange={(next) => {
            setCheckedIds(next.map((role) => role.id));
          }}
        />

        <RoleOptionList roles={selected} />

        {errorCode !== null && (
          <Alert severity="error">{tErrors(errorCode)}</Alert>
        )}
      </Stack>
    </Dialog>
  );
};
