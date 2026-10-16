import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type AssignUserRolesMutation,
  type SetUserEnabledMutation,
  useAssignUserRolesMutation,
  useSetUserEnabledMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { AssignRolesDialog } from "./AssignRolesDialog/AssignRolesDialog";
import { CopyOrgRolesDialog } from "./CopyOrgRolesDialog/CopyOrgRolesDialog";
import { OrgChangeDialog } from "./OrgChangeDialog/OrgChangeDialog";
import { OrgPickerDialog } from "./OrgPickerDialog/OrgPickerDialog";
import { OrgTreePanel } from "./OrgTreePanel";
import { ToggleEnabledDialog } from "./ToggleEnabledDialog/ToggleEnabledDialog";
import { UserFormDialog } from "./UserFormDialog/UserFormDialog";
import { UserTable } from "./UserTable/UserTable";
import { UserToolbar } from "./UserToolbar";
import { useUserManagerData } from "./useUserManagerData";
import { useUserOrgsFlow } from "./useUserOrgsFlow";
import {
  type UserManagerErrorCode,
  userManagerErrorOf,
} from "./user-manager-error";
import { USERS_PAGE_SIZE, type UserRow } from "./user-manager-types";

/**
 * 使用者管理(模組 key `system.user-manager`,正本 `docs/modules/user-manager.md`;
 * Figma「Screen / Admin 使用者管理」30:105)。
 * 左組織樹選範圍 → 右分頁清單;所有動作都是這一頁上的彈窗,顯示與否依權限(ADR-0011)。
 */
export const UserManagerPage = () => {
  const t = useTranslations("admin.userManager");
  const tErrors = useTranslations("admin.userManager.errors");
  const { session } = useSession();
  const data = useUserManagerData();

  /** 表單彈窗:null = 沒開;`{ user: null }` = 新增;`{ user }` = 編輯 */
  const [formTarget, setFormTarget] = useState<{ user: UserRow | null } | null>(
    null,
  );
  const [rolesUser, setRolesUser] = useState<UserRow | null>(null);
  const [toggleUser, setToggleUser] = useState<UserRow | null>(null);
  /** 複製組織與角色的來源(列動作所在的那一列);null = 沒開 */
  const [copySource, setCopySource] = useState<UserRow | null>(null);
  const [actionError, setActionError] = useState<UserManagerErrorCode | null>(
    null,
  );

  const orgsFlow = useUserOrgsFlow((userId) => {
    void data.invalidate(userId);
  });

  const onActionError = (error: unknown) => {
    setActionError(userManagerErrorOf(error).code);
  };

  /** 失敗的 Snackbar 文案與頁面上那一行錯誤同一份解讀(#376)。 */
  const feedbackError = (error: unknown) =>
    tErrors(userManagerErrorOf(error).code);

  const setUserEnabled = useSetUserEnabledMutation(
    session.client,
    useMutationFeedback<SetUserEnabledMutation>({
      success: (payload) =>
        payload.setUserEnabled.user.enabled
          ? t("feedback.enableSuccess")
          : t("feedback.disableSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        setToggleUser(null);
        void data.invalidate(payload.setUserEnabled.user.id);
      },
      onError: onActionError,
    }),
  );

  const assignRoles = useAssignUserRolesMutation(
    session.client,
    useMutationFeedback<AssignUserRolesMutation>({
      success: t("feedback.assignRolesSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        setRolesUser(null);
        void data.invalidate(payload.assignUserRoles.user.id);
      },
      onError: onActionError,
    }),
  );

  const pageCount = Math.max(1, Math.ceil(data.totalCount / USERS_PAGE_SIZE));

  /**
   * 擁有者在「選擇所屬組織」裡鎖住的節點(#362):只鎖他擁有的租戶頂層 —— api 的
   * `assertOwnedOrgsKept` 也只擋這一件,加入其他組織一直是允許的。其他人沒有鎖。
   */
  const lockedOrgIdsFor = (user: UserRow): string[] =>
    data.protectedOwnerOrgId !== null && user.id === data.protectedOwnerUserId
      ? [data.protectedOwnerOrgId]
      : [];

  return (
    // 撐滿殼給的內容區高度(#183 / Figma 30:166:左右兩塊等高、各自內部捲動)
    <Stack direction="row" spacing={3} sx={{ flex: 1, minHeight: 0 }}>
      <OrgTreePanel
        nodes={data.orgNodes}
        isLoading={data.isOrgTreeLoading}
        isAvailable={data.isOrgTreeAvailable}
        selectedOrgId={data.selectedOrgId}
        onSelectOrg={data.selectOrg}
      />

      <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <UserToolbar
          keyword={data.keyword}
          onKeywordChange={data.setKeyword}
          canCreate={data.ability.canCreate}
          onCreate={() => {
            setFormTarget({ user: null });
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("outOfScopeHint")}
        </Typography>
        {/* 表格吃掉剩下的高度、自己捲;分頁列永遠留在卡片底部(#183 / Figma 31:82 + 31:157) */}
        <Card
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 捲動責任在 Table 自己的容器(#299),這層只負責把剩下的高度給它,
              不要再開一層 overflow: auto,否則窄視窗下會出現兩條捲軸 */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <UserTable
              rows={data.rows}
              isLoading={data.isUsersLoading}
              ability={data.ability}
              protectedOwnerUserId={data.protectedOwnerUserId}
              isOrgTreeAvailable={data.isOrgTreeAvailable}
              onEdit={(user) => {
                setFormTarget({ user });
              }}
              onManageOrgs={orgsFlow.open}
              onAssignRoles={setRolesUser}
              onToggleEnabled={(user) => {
                setActionError(null);
                setToggleUser(user);
              }}
              onCopyOrgRoles={setCopySource}
            />
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", px: 3, py: 1.5 }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {t("total", {
                total: data.totalCount,
                pageSize: USERS_PAGE_SIZE,
              })}
            </Typography>
            <Pagination
              count={pageCount}
              page={data.page}
              onChange={(_event, nextPage) => {
                data.setPage(nextPage);
              }}
            />
          </Stack>
        </Card>
        {actionError !== null && toggleUser === null && rolesUser === null && (
          <Typography variant="body2" color="error.main">
            {tErrors(actionError)}
          </Typography>
        )}
      </Stack>

      {formTarget !== null && (
        <UserFormDialog
          user={formTarget.user}
          defaultOrgIds={
            data.selectedOrgId === null ? [] : [data.selectedOrgId]
          }
          orgNodes={data.orgNodes}
          isOrgTreeAvailable={data.isOrgTreeAvailable}
          ability={data.ability}
          onClose={() => {
            setFormTarget(null);
          }}
          onSaved={() => {
            void data.invalidate(formTarget.user?.id);
            setFormTarget(null);
          }}
        />
      )}

      {orgsFlow.flow?.stage === "picker" && (
        <OrgPickerDialog
          title={t("orgPicker.title", { name: orgsFlow.flow.user.name })}
          nodes={data.orgNodes}
          isLoading={data.isOrgTreeLoading}
          initialSelectedIds={orgsFlow.flow.user.orgs.map((org) => org.id)}
          lockedOrgIds={lockedOrgIdsFor(orgsFlow.flow.user)}
          lockedHint={t("orgPicker.ownerLocked")}
          isSubmitting={orgsFlow.isSubmitting}
          onCancel={orgsFlow.close}
          onConfirm={orgsFlow.pick}
        />
      )}

      {orgsFlow.flow?.stage === "confirm" && (
        <OrgChangeDialog
          userName={orgsFlow.flow.user.name}
          preview={orgsFlow.flow.preview}
          isSubmitting={orgsFlow.isSubmitting}
          errorCode={orgsFlow.errorCode}
          onCancel={orgsFlow.close}
          onConfirm={orgsFlow.confirm}
        />
      )}

      {rolesUser !== null && (
        <AssignRolesDialog
          user={rolesUser}
          isSubmitting={assignRoles.isPending}
          errorCode={actionError}
          onCancel={() => {
            setActionError(null);
            setRolesUser(null);
          }}
          onConfirm={(roleIds) => {
            setActionError(null);
            assignRoles.mutate({ input: { userId: rolesUser.id, roleIds } });
          }}
        />
      )}

      {copySource !== null && (
        <CopyOrgRolesDialog
          source={copySource}
          onClose={() => {
            setCopySource(null);
          }}
          onCopied={(targetId) => {
            setCopySource(null);
            void data.invalidate(targetId);
          }}
        />
      )}

      {toggleUser !== null && (
        <ToggleEnabledDialog
          user={toggleUser}
          isSubmitting={setUserEnabled.isPending}
          errorCode={actionError}
          onCancel={() => {
            setActionError(null);
            setToggleUser(null);
          }}
          onConfirm={() => {
            setActionError(null);
            setUserEnabled.mutate({
              input: { id: toggleUser.id, enabled: !toggleUser.enabled },
            });
          }}
        />
      )}
    </Stack>
  );
};
