import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type SetRoleEnabledMutation,
  useDeleteRoleMutation,
  useRoleQuery,
  useSetRoleEnabledMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";

import { DiscardChangesDialog } from "@/components/base/DiscardChangesDialog";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUnsavedGuard } from "@/hooks/base/useUnsavedGuard";
import {
  editAbilityOf,
  useUrlEdit,
  useUrlEditGuard,
} from "@/hooks/base/useUrlEdit";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useUrlState } from "@/hooks/base/useUrlState";

import { DeleteRoleDialog } from "./DeleteRoleDialog";
import { RoleDetailPanel } from "./RoleDetailPanel/RoleDetailPanel";
import { RoleFormDialog } from "./RoleFormDialog/RoleFormDialog";
import { RoleListPanel } from "./RoleListPanel/RoleListPanel";
import { ToggleRoleEnabledDialog } from "./ToggleRoleEnabledDialog";
import {
  type RoleManagerError,
  roleManagerErrorOf,
} from "./role-manager-error";
import {
  type RoleDetailTab,
  type RoleRow,
  roleDetailTabSchema,
  rowAbilityOf,
} from "./role-manager-types";
import { useRoleManagerData } from "./useRoleManagerData";
import { useRoleMatrix } from "./useRoleMatrix";

/** 未儲存時被攔下的動作:確認放棄後才執行。 */
type PendingNav =
  | { kind: "tab"; tab: RoleDetailTab }
  /** `roleId` null = 手機寬按 [← 返回] 回清單 */
  | { kind: "role"; roleId: string | null };

/**
 * 角色管理(模組 key `system.role-manager`,正本 `docs/modules/role-manager.md`;
 * Figma「Screen / Admin 角色管理」44:44)。
 * 左清單選角色 → 右兩個頁籤(權限矩陣、分配使用者);動作都是彈窗,顯示與否依權限(ADR-0011)。
 *
 * **手機寬(< `sm`)一次只顯示一邊**:網址沒有選取(`?detail=`)時清單滿版;點一個角色 → 詳情滿版,
 * 頂部 [← 返回] 清掉選取回到清單(矩陣有未存變更時一樣先問)。清單藏起來不卸載,篩選與捲動都留著。
 */
export const RoleManagerPage = () => {
  const t = useTranslations("admin.roleManager");
  const tErrors = useTranslations("admin.roleManager.errors");
  const { session } = useSession();
  const data = useRoleManagerData();

  // 右欄頁籤記在網址 `?tab=`(REACT-14);切頁籤要先被「未存的矩陣變更」攔下,所以不用 PageTabs、直接用 Tabs
  const [activeTab, setActiveTab] = useUrlState("tab", roleDetailTabSchema);
  /** null = 沒開;`{ role: null }` = 新增;`{ role }` = 編輯 */
  const [isCreating, setIsCreating] = useState(false);
  /**
   * 編輯彈窗記在網址 `?edit=<id>`(REACT-14):打開時以 id 讀那一個角色的最新資料;
   * 沒有編輯權限(含種子角色鎖定)、或讀不到時清掉參數。
   */
  const edit = useUrlEdit();
  const editTarget = useRoleQuery(
    session.client,
    { id: edit.requestedId ?? "" },
    {
      enabled: edit.requestedId !== null && data.ability.canEdit,
      retry: false,
    },
  );
  const editRole = editTarget.data?.role.role;
  const editingId = useUrlEditGuard({
    edit,
    canEdit: editAbilityOf(
      data.ability.canEdit,
      editRole === undefined
        ? undefined
        : rowAbilityOf(data.ability, editRole).canEdit,
    ),
    isMissing: editTarget.isError,
    // 沒有編輯權限、或種子角色鎖定:停在該角色的詳情(同組織、表單、流程)
    onNoPermission: data.selectRole,
  });
  const [toggleRole, setToggleRole] = useState<RoleRow | null>(null);
  const [deleteRole, setDeleteRole] = useState<RoleRow | null>(null);
  const [actionError, setActionError] = useState<RoleManagerError | null>(null);
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);

  const matrix = useRoleMatrix(data.selectedRole?.id ?? null, {
    // 權限 × 角色種類規則:種子角色即使有 edit-matrix 權限也整棵鎖住
    canEdit:
      data.selectedRole !== null &&
      rowAbilityOf(data.ability, data.selectedRole).canEditMatrix,
    onSaved: (roleId) => {
      void data.invalidate(roleId);
    },
  });
  useUnsavedGuard(matrix.isDirty);

  const onActionError = (error: unknown) => {
    setActionError(roleManagerErrorOf(error));
  };

  /** 失敗的 Snackbar 文案與彈窗內那一條錯誤同一份解讀。 */
  const feedbackError = (error: unknown) =>
    tErrors(roleManagerErrorOf(error).code);

  const setRoleEnabled = useSetRoleEnabledMutation(
    session.client,
    useMutationFeedback<SetRoleEnabledMutation>({
      success: (payload) =>
        payload.setRoleEnabled.role.enabled
          ? t("feedback.enableSuccess")
          : t("feedback.disableSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        setToggleRole(null);
        void data.invalidate(payload.setRoleEnabled.role.id);
      },
      onError: onActionError,
    }),
  );
  const removeRole = useDeleteRoleMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.deleteSuccess"),
      error: feedbackError,
      onSuccess: () => {
        setDeleteRole(null);
        void data.invalidate();
      },
      onError: onActionError,
    }),
  );

  /** 未儲存的矩陣變更會攔下「切頁籤」與「換角色」(Figma 70:209)。 */
  const guard = (nav: PendingNav) => {
    if (matrix.isDirty) {
      setPendingNav(nav);
      return;
    }
    applyNav(nav);
  };
  const applyNav = (nav: PendingNav) => {
    if (nav.kind === "tab") {
      setActiveTab(nav.tab);
      return;
    }
    data.selectRole(nav.roleId);
  };

  const isMobile = useBreakpointDown("sm");
  const [urlPickedRoleId] = useUrlSelectedId();
  const isDetailShown = urlPickedRoleId !== null;

  if (!data.ability.canView) {
    return <Alert severity="info">{t("noViewPermission")}</Alert>;
  }

  return (
    // 撐滿殼給的內容區高度(STYLE-08 / Figma 44:188:左右兩塊等高、各自內部捲動)
    // 手機寬不釘高(STYLE-08):主從兩塊依內容長高、交給 <main> 捲;sm 起才撐滿殼高、各自內部捲動
    <Stack
      direction="row"
      spacing={{ xs: 0, sm: 3 }}
      sx={{ flex: { xs: "1 0 auto", sm: 1 }, minHeight: 0 }}
    >
      {/* sm 以上這層不參與排版(contents,仍標 minHeight: 0 守 STYLE-08 高度鏈);手機寬依選取只顯示一邊,另一邊藏起來但不卸載 */}
      <Box
        sx={
          isMobile
            ? { display: isDetailShown ? "none" : "flex", flex: 1, minWidth: 0 }
            : { display: "contents", minHeight: 0 }
        }
      >
        <RoleListPanel
          rows={data.rows}
          isLoading={data.isLoading}
          totalCount={data.totalCount}
          keyword={data.keyword}
          onKeywordChange={data.setKeyword}
          ownerOrgId={data.ownerOrgId}
          onOwnerOrgChange={data.setOwnerOrgId}
          ownerOrgOptions={data.ownerOrgOptions}
          page={data.page}
          onPageChange={data.setPage}
          selectedRoleId={
            isMobile ? urlPickedRoleId : (data.selectedRole?.id ?? null)
          }
          onSelectRole={(roleId) => {
            guard({ kind: "role", roleId });
          }}
          ability={data.ability}
          onCreate={() => {
            setActionError(null);
            setIsCreating(true);
          }}
          onEdit={(role) => {
            setActionError(null);
            edit.open(role.id);
          }}
          onToggleEnabled={(role) => {
            setActionError(null);
            setToggleRole(role);
          }}
          onDelete={(role) => {
            setActionError(null);
            setDeleteRole(role);
          }}
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
        {isMobile && (
          <Box>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                guard({ kind: "role", roleId: null });
              }}
            >
              {t("mobileBack")}
            </Button>
          </Box>
        )}
        {actionError !== null &&
          toggleRole === null &&
          deleteRole === null &&
          !isCreating &&
          editingId === null && (
            <Alert severity="error">{tErrors(actionError.code)}</Alert>
          )}
        <RoleDetailPanel
          role={data.selectedRole}
          ability={data.ability}
          activeTab={activeTab}
          onChangeTab={(tab) => {
            guard({ kind: "tab", tab });
          }}
          matrix={matrix}
          onUsersChanged={() => {
            void data.invalidate(data.selectedRole?.id);
          }}
        />
      </Stack>

      {(isCreating || (editingId !== null && editRole !== undefined)) && (
        <RoleFormDialog
          key={isCreating ? "create" : (editingId ?? "")}
          role={isCreating ? null : (editRole ?? null)}
          onCancel={() => {
            setIsCreating(false);
            edit.close();
          }}
          onSaved={(roleId) => {
            setIsCreating(false);
            edit.close();
            data.selectRole(roleId);
            void data.invalidate(roleId);
          }}
        />
      )}

      {toggleRole !== null && (
        <ToggleRoleEnabledDialog
          role={toggleRole}
          isSubmitting={setRoleEnabled.isPending}
          errorCode={actionError?.code ?? null}
          onCancel={() => {
            setActionError(null);
            setToggleRole(null);
          }}
          onConfirm={() => {
            setActionError(null);
            setRoleEnabled.mutate({
              input: { id: toggleRole.id, enabled: !toggleRole.enabled },
            });
          }}
        />
      )}

      {deleteRole !== null && (
        <DeleteRoleDialog
          role={deleteRole}
          isSubmitting={removeRole.isPending}
          errorCode={actionError?.code ?? null}
          reasons={actionError?.reasons ?? []}
          references={actionError?.references ?? []}
          onCancel={() => {
            setActionError(null);
            setDeleteRole(null);
          }}
          onConfirm={() => {
            setActionError(null);
            removeRole.mutate({ input: { id: deleteRole.id } });
          }}
        />
      )}

      {pendingNav !== null && (
        <DiscardChangesDialog
          namespace="admin.roleManager.discard"
          onCancel={() => {
            setPendingNav(null);
          }}
          onConfirm={() => {
            matrix.reset();
            applyNav(pendingNav);
            setPendingNav(null);
          }}
        />
      )}
    </Stack>
  );
};
