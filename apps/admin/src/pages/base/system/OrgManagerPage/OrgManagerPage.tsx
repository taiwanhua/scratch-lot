import { useCallback, useState } from "react";
import { useTranslations } from "use-intl";

import {
  type SetOrgEnabledMutation,
  useDeleteOrgMutation,
  useRevokeTenantProvisionMutation,
  useSetOrgEnabledMutation,
} from "@repo/graphql";
import { Stack } from "@repo/ui/stack";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";
import { orgTrail } from "@/lib/base/org-tree";

import { CreateChildOrgDialog } from "./CreateChildOrgDialog";
import { DeleteOrgDialog } from "./DeleteOrgDialog";
import { EditOrgDialog } from "./EditOrgDialog/EditOrgDialog";
import { OrgDetailPanel } from "./OrgDetailPanel/OrgDetailPanel";
import { OrgTreePanel } from "./OrgTreePanel";
import { ProvisionTenantDialog } from "./ProvisionTenantDialog/ProvisionTenantDialog";
import { RevokeProvisionDialog } from "./RevokeProvisionDialog";
import { ToggleEnabledDialog } from "./ToggleEnabledDialog";
import { type OrgManagerError, orgManagerErrorOf } from "./org-manager-error";
import { useMoveTargets } from "./useMoveTargets";
import { useOrgManagerData } from "./useOrgManagerData";
import { isTenantTop, useTenantOwner } from "./useTenantOwner";

/**
 * 不進網址的彈窗(新增、開通、確認類),同時只會開一個;用一個標籤而不是五個布林,避免出現「兩個都開著」的狀態。
 * 編輯彈窗在網址 `?edit=<id>`(見下方 `useUrlEdit`)。
 */
type OpenDialog =
  | "createChild"
  | "toggleEnabled"
  | "delete"
  | "provision"
  | "revokeProvision"
  | null;

/**
 * 組織管理(模組 key `system.org-manager`,正本 `docs/modules/org-manager.md`;
 * Figma「Screen / Admin 組織管理」根組織視角 87:3、租戶視角 92:694)。
 *
 * 左樹選組織 → 右側顯示該組織的資料與可用動作;所有動作都是這一頁上的彈窗。
 * **兩種視角不是兩套頁**:樹根是誰(根組織 / 租戶頂層)與手上有沒有 `tenant-ops` 那三筆權限,
 * 已經足以決定畫面,不需要「我是不是超級管理員」這種旗標。
 */
export const OrgManagerPage = () => {
  const t = useTranslations("admin.orgManager");
  const tErrors = useTranslations("admin.orgManager.errors");
  const { session } = useSession();
  /**
   * 編輯彈窗記在網址 `?edit=<id>`(REACT-14):編的就是選中的組織,所以網址上的組織同時是選中的那一個
   * (以 id 讀最新的單筆);不在樹裡 → 提示找不到,沒有編輯權限 → 停在它的詳情。
   */
  const edit = useUrlEdit();
  const data = useOrgManagerData(edit.requestedId);
  const selectOrg = data.selectOrg;
  const keepDetail = useCallback(
    (orgId: string) => {
      selectOrg(orgId);
    },
    [selectOrg],
  );
  const editingId = useUrlEditGuard({
    edit,
    canEdit: data.ability.canEdit,
    isMissing:
      edit.requestedId !== null &&
      data.isOrgTreeReady &&
      data.selectedOrgId !== edit.requestedId,
    onNoPermission: keepDetail,
  });
  /** 關掉編輯彈窗:停在剛編的那一個組織的詳情 */
  const closeEdit = () => {
    if (editingId !== null) {
      selectOrg(editingId);
    }
    edit.close();
    setActionError(null);
  };
  const owner = useTenantOwner(data.org);
  const moveTargets = useMoveTargets({
    nodes: data.orgNodes,
    isRootPerspective: data.isRootPerspective,
    orgId: data.selectedOrgId,
  });

  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const [actionError, setActionError] = useState<OrgManagerError | null>(null);

  const closeDialog = () => {
    setOpenDialog(null);
    setActionError(null);
  };

  const onActionError = (error: unknown) => {
    setActionError(orgManagerErrorOf(error));
  };

  /** 失敗的 Snackbar 文案與彈窗內那一條錯誤同一份解讀。 */
  const feedbackError = (error: unknown) =>
    tErrors(orgManagerErrorOf(error).code);

  const setOrgEnabled = useSetOrgEnabledMutation(
    session.client,
    useMutationFeedback<SetOrgEnabledMutation>({
      success: (payload) =>
        payload.setOrgEnabled.org.enabled
          ? t("feedback.enableSuccess")
          : t("feedback.disableSuccess"),
      error: feedbackError,
      onSuccess: (payload) => {
        closeDialog();
        void data.invalidate(payload.setOrgEnabled.org.id);
      },
      onError: onActionError,
    }),
  );

  const deleteOrg = useDeleteOrgMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.deleteSuccess"),
      error: feedbackError,
      onSuccess: () => {
        closeDialog();
        data.selectOrg(null);
        void data.invalidate();
      },
      onError: onActionError,
    }),
  );

  /** 撤銷開通後那一節整個不見了,與刪除一樣要清掉選取再重查整棵樹。 */
  const revokeProvision = useRevokeTenantProvisionMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.revokeSuccess"),
      error: feedbackError,
      onSuccess: () => {
        closeDialog();
        data.selectOrg(null);
        void data.invalidate();
      },
      onError: onActionError,
    }),
  );

  /**
   * 租戶頂層對租戶內的人:停用 / 刪除 / 搬移只有根組織能做(ADR-0009)。
   * api 也會擋(`assertTenantTopOperableBy`);這裡只是讓人先看得出來。
   */
  const isTenantTopProtected = isTenantTop(data.org) && !data.isRootPerspective;

  const trail = orgTrail(data.orgNodes, data.selectedOrgId ?? "");
  const parentName = trail.length > 1 ? (trail.at(-2)?.name ?? null) : null;
  const selectedNode = trail.at(-1);
  const isSelectionActionable =
    selectedNode !== undefined && !selectedNode.outOfScope;

  return (
    // 撐滿殼給的內容區高度(Figma 87:214:左右兩塊等高、各自內部捲動)
    <Stack direction="row" spacing={3} sx={{ flex: 1, minHeight: 0 }}>
      <OrgTreePanel
        nodes={data.orgNodes}
        isLoading={data.isOrgTreeLoading}
        isRootPerspective={data.isRootPerspective}
        selectedOrgId={data.selectedOrgId}
        onSelectOrg={data.selectOrg}
        canProvision={data.ability.canProvision}
        canCreateChild={data.ability.canCreateChild}
        isCreateChildEnabled={isSelectionActionable}
        onProvision={() => {
          setOpenDialog("provision");
        }}
        onCreateChild={() => {
          setOpenDialog("createChild");
        }}
      />

      <OrgDetailPanel
        org={data.org}
        isLoading={data.isOrgLoading}
        parentName={parentName}
        ownerName={owner.ownerName}
        hasOwner={isTenantTop(data.org)}
        ability={data.ability}
        isTenantTopProtected={isTenantTopProtected}
        onEdit={() => {
          if (data.org !== undefined) {
            edit.open(data.org.id);
          }
        }}
        onToggleEnabled={() => {
          setActionError(null);
          setOpenDialog("toggleEnabled");
        }}
        onDelete={() => {
          setActionError(null);
          setOpenDialog("delete");
        }}
        canRevokeProvision={
          data.ability.canRevokeProvision &&
          data.isRootPerspective &&
          isTenantTop(data.org)
        }
        onRevokeProvision={() => {
          setActionError(null);
          setOpenDialog("revokeProvision");
        }}
      />

      {openDialog === "createChild" && data.selectedOrgId !== null && (
        <CreateChildOrgDialog
          parentId={data.selectedOrgId}
          parentName={data.org?.name ?? ""}
          onClose={closeDialog}
          onCreated={(orgId) => {
            closeDialog();
            void data.invalidate(orgId);
          }}
        />
      )}

      {editingId !== null && data.org?.id === editingId && (
        <EditOrgDialog
          org={data.org}
          parentOptions={moveTargets}
          isTenantTop={isTenantTop(data.org)}
          isTenantTopProtected={isTenantTopProtected}
          ownerCandidates={owner.candidates}
          ability={data.ability}
          onClose={closeEdit}
          onSaved={() => {
            const orgId = data.org?.id;
            closeEdit();
            void data.invalidate(orgId);
          }}
        />
      )}

      {openDialog === "toggleEnabled" && data.org !== undefined && (
        <ToggleEnabledDialog
          org={data.org}
          isSubmitting={setOrgEnabled.isPending}
          errorCode={actionError?.code ?? null}
          onCancel={closeDialog}
          onConfirm={() => {
            setActionError(null);
            setOrgEnabled.mutate({
              input: {
                id: data.org?.id ?? "",
                enabled: !(data.org?.enabled ?? false),
              },
            });
          }}
        />
      )}

      {openDialog === "delete" && data.org !== undefined && (
        <DeleteOrgDialog
          org={data.org}
          isSubmitting={deleteOrg.isPending}
          errorCode={actionError?.code ?? null}
          reasons={actionError?.reasons ?? []}
          onCancel={closeDialog}
          onConfirm={() => {
            setActionError(null);
            deleteOrg.mutate({ input: { id: data.org?.id ?? "" } });
          }}
        />
      )}

      {openDialog === "revokeProvision" && data.org !== undefined && (
        <RevokeProvisionDialog
          org={data.org}
          ownerAccount={owner.ownerAccount}
          roleName={owner.tenantAdminRoleName}
          isSubmitting={revokeProvision.isPending}
          errorCode={actionError?.code ?? null}
          reasons={actionError?.reasons ?? []}
          onCancel={closeDialog}
          onConfirm={() => {
            setActionError(null);
            revokeProvision.mutate({
              input: { orgId: data.org?.id ?? "" },
            });
          }}
        />
      )}

      {openDialog === "provision" && (
        <ProvisionTenantDialog
          onClose={closeDialog}
          onProvisioned={(orgId) => {
            closeDialog();
            void data.invalidate(orgId);
          }}
        />
      )}
    </Stack>
  );
};
