import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type AssignUserRolesMutation,
  type SetUserEnabledMutation,
  useAssignUserRolesMutation,
  useSetUserEnabledMutation,
  useUserQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";

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
 *
 * **手機寬(< `sm`)一次只顯示一邊**:網址沒有點選組織(`?list=` 的 `org`)時組織樹滿版;點一個組織 → 使用者清單滿版,
 * 頂部 [← 返回] 清掉點選回到樹(樹藏起來不卸載,展開與捲動都留著)。看不到組織樹的人(沒有組織管理檢視權限)直接看清單。
 */
export const UserManagerPage = () => {
  const t = useTranslations("admin.userManager");
  const tErrors = useTranslations("admin.userManager.errors");
  const { session } = useSession();
  const data = useUserManagerData();
  const isMobile = useBreakpointDown("sm");

  /** 新增彈窗(不進網址:內容全是未存輸入) */
  const [isCreating, setIsCreating] = useState(false);
  /**
   * 編輯彈窗記在網址 `?edit=<id>`(REACT-14):打開時以 id 讀最新的單筆(與彈窗同一把查詢快取);
   * 沒有編輯權限、或那一筆讀不到時清掉參數。
   */
  const edit = useUrlEdit();
  const editTarget = useUserQuery(
    session.client,
    { id: edit.requestedId ?? "" },
    {
      enabled: edit.requestedId !== null && data.ability.canEdit,
      retry: false,
    },
  );
  // 手機寬顯示清單那一邊:點過組織、正在編輯某人,或根本沒有組織樹可選
  const isDetailShown =
    data.pickedOrgId !== null ||
    edit.requestedId !== null ||
    !data.isOrgTreeAvailable;
  const editingId = useUrlEditGuard({
    edit,
    canEdit: data.ability.canEdit,
    isMissing: editTarget.isError,
  });
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

  /** 失敗的 Snackbar 文案與頁面上那一行錯誤同一份解讀。 */
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
   * 擁有者在「選擇所屬組織」裡鎖住的節點:只鎖他擁有的租戶頂層 —— api 的
   * `assertOwnedOrgsKept` 也只擋這一件,加入其他組織一直是允許的。其他人沒有鎖。
   */
  const lockedOrgIdsFor = (user: UserRow): string[] =>
    data.protectedOwnerOrgId !== null && user.id === data.protectedOwnerUserId
      ? [data.protectedOwnerOrgId]
      : [];

  return (
    // 撐滿殼給的內容區高度(Figma 30:166:左右兩塊等高、各自內部捲動)
    // 手機寬不釘高(STYLE-08):主從兩塊依內容長高、交給 <main> 捲;sm 起才撐滿殼高、各自內部捲動
    <Stack
      direction="row"
      spacing={{ xs: 0, sm: 3 }}
      sx={{ flex: { xs: "1 0 auto", sm: 1 }, minHeight: 0 }}
    >
      {/* sm 以上這層不參與排版(contents,仍標 minHeight: 0 守 STYLE-08 高度鏈);手機寬依點選只顯示一邊,另一邊藏起來但不卸載 */}
      <Box
        sx={
          isMobile
            ? {
                display: isDetailShown ? "none" : "flex",
                flex: 1,
                minWidth: 0,
              }
            : { display: "contents", minHeight: 0 }
        }
      >
        <OrgTreePanel
          nodes={data.orgNodes}
          isLoading={data.isOrgTreeLoading}
          isAvailable={data.isOrgTreeAvailable}
          selectedOrgId={isMobile ? data.pickedOrgId : data.selectedOrgId}
          onSelectOrg={data.selectOrg}
        />
      </Box>

      <Stack
        spacing={1.5}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: isMobile && !isDetailShown ? "none" : "flex",
        }}
      >
        {isMobile && data.isOrgTreeAvailable && (
          <Box>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                data.selectOrg(null);
              }}
            >
              {t("mobileBack")}
            </Button>
          </Box>
        )}
        <UserToolbar
          keyword={data.keyword}
          onKeywordChange={data.setKeyword}
          canCreate={data.ability.canCreate}
          onCreate={() => {
            setIsCreating(true);
          }}
        />
        <Typography variant="caption" color="textSecondary">
          {t("outOfScopeHint")}
        </Typography>
        {/* 表格吃掉剩下的高度、自己捲;分頁列永遠留在卡片底部(Figma 31:82 + 31:157) */}
        <Card
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 捲動責任在 Table 自己的容器,這層只負責把剩下的高度給它,
              不要再開一層 overflow: auto,否則窄視窗下會出現兩條捲軸 */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <UserTable
              rows={data.rows}
              isLoading={data.isUsersLoading}
              ability={data.ability}
              protectedOwnerUserId={data.protectedOwnerUserId}
              isOrgTreeAvailable={data.isOrgTreeAvailable}
              onEdit={(user) => {
                edit.open(user.id);
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
            <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
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
          <Typography variant="body2" color="error">
            {tErrors(actionError)}
          </Typography>
        )}
      </Stack>

      {(isCreating || editingId !== null) && (
        <UserFormDialog
          key={isCreating ? "create" : (editingId ?? "")}
          userId={isCreating ? null : editingId}
          defaultOrgIds={
            data.selectedOrgId === null ? [] : [data.selectedOrgId]
          }
          orgNodes={data.orgNodes}
          isOrgTreeAvailable={data.isOrgTreeAvailable}
          ability={data.ability}
          onClose={() => {
            setIsCreating(false);
            edit.close();
          }}
          onSaved={() => {
            void data.invalidate(editingId ?? undefined);
            setIsCreating(false);
            edit.close();
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
