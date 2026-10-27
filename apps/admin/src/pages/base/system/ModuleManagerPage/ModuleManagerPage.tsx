import { Suspense, useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  type SetModuleEnabledMutation,
  type SetPermissionEnabledMutation,
  useSetModuleEnabledMutation,
  useSetModuleIconMutation,
  useSetPermissionEnabledMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import type { ModuleIconKey } from "@repo/ui/icons";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useUrlState } from "@/hooks/base/useUrlState";

import { DisableModuleDialog } from "./DisableModuleDialog";
import { ModuleDetailPanel } from "./ModuleDetailPanel/ModuleDetailPanel";
import { ModuleTreePanel } from "./ModuleTreePanel";
import {
  LazyListColumnsDialog,
  LazyRetiredPermissionsDialog,
} from "./lazy-form-dialogs";
import { moduleManagerErrorOf } from "./module-manager-error";
import {
  LIST_COLUMNS_PERMISSION,
  MODULE_MANAGER_PERMISSIONS,
} from "./module-manager-permissions";
import type {
  ModuleAdminPermissionLike,
  ModuleManagerErrorCode,
} from "./module-manager-types";
import { useModuleManagerData } from "./useModuleManagerData";

/** 開著的唯讀彈窗(`?dialog=`):目前只有退役權限清單;`none` = 沒開(網址不寫)。 */
const dialogSchema = z.enum(["none", "retired"]).default("none");

/**
 * 模組與權限(模組 key `system.module-manager`,正本 `docs/modules/module-manager.md`;
 * Figma「Screen / Admin 模組與權限」89:2、停用確認 211:331)。**根組織專屬**(ADR-0009)。
 *
 * 左樹是治理面的全樹(含 hidden、api 樹、已停用者),右面板是所選模組的資料與權限清單;
 * 除 enabled 開關外全部唯讀 —— 模組與權限是種子資料,結構異動走 code + PR(ADR-0002)。
 *
 * 「非根組織不能進來」不在這裡判:本模組 `isRootOnly`,租戶的 `me.modules` 裡根本沒有它,
 * 路由層就擋掉了(ADR-0011);api 也各自再守一次。前端不重複第三份判斷。
 *
 * **手機寬(< `sm`)一次只顯示一邊**:網址沒有選取(`?detail=`)時模組樹滿版;點一個模組 → 詳情滿版,
 * 頂部 [← 返回] 清掉選取回到樹(樹藏起來不卸載,展開與捲動都留著)。
 */
export const ModuleManagerPage = () => {
  const { session } = useSession();
  const t = useTranslations("admin.moduleManager");
  const data = useModuleManagerData();
  const isMobile = useBreakpointDown("sm");
  const [urlPickedModuleId] = useUrlSelectedId();
  const isDetailShown = urlPickedModuleId !== null;
  const { hasPermission } = usePermissions();
  const [isListColumnsOpen, setIsListColumnsOpen] = useState(false);
  // 退役權限清單是唯讀的檢視彈窗:開著的狀態記在網址 `?dialog=retired`(REACT-14),重新整理還開著
  const [dialog, setDialog] = useUrlState("dialog", dialogSchema);
  const isRetiredOpen = dialog === "retired";

  const [isDisableOpen, setIsDisableOpen] = useState(false);
  const [actionError, setActionError] = useState<ModuleManagerErrorCode | null>(
    null,
  );
  const [pendingPermissionId, setPendingPermissionId] = useState<string | null>(
    null,
  );

  const onActionError = (error: unknown) => {
    setActionError(moduleManagerErrorOf(error).code);
  };

  /** 失敗的 Snackbar 文案與頁面上那一條 Alert 同一份解讀。 */
  const feedbackError = (error: unknown) =>
    t(`errors.${moduleManagerErrorOf(error).code}`);

  const setModuleEnabled = useSetModuleEnabledMutation(
    session.client,
    useMutationFeedback<SetModuleEnabledMutation>({
      success: (payload) =>
        payload.setModuleEnabled.module.enabled
          ? t("feedback.enableSuccess")
          : t("feedback.disableSuccess"),
      error: feedbackError,
      onSuccess: () => {
        setIsDisableOpen(false);
        setActionError(null);
        void data.invalidate();
      },
      onError: onActionError,
    }),
  );

  /**
   * 換圖示:不必確認也不連動任何東西,失敗就照一般錯誤顯示;
   * 成功後 invalidate `ModuleTree` + `me` —— 側欄吃的是 `me.modules[].icon`,
   * 操作者自己的側欄要立刻換圖。
   */
  const setModuleIcon = useSetModuleIconMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.setIconSuccess"),
      error: feedbackError,
      onSuccess: () => {
        setActionError(null);
        void data.invalidate();
      },
      onError: onActionError,
    }),
  );

  const setPermissionEnabled = useSetPermissionEnabledMutation(
    session.client,
    useMutationFeedback<SetPermissionEnabledMutation>({
      success: (payload) =>
        payload.setPermissionEnabled.permission.enabled
          ? t("feedback.permissionEnableSuccess")
          : t("feedback.permissionDisableSuccess"),
      error: feedbackError,
      onSuccess: () => {
        setPendingPermissionId(null);
        void data.invalidate();
      },
      onError: (error: unknown) => {
        setPendingPermissionId(null);
        onActionError(error);
      },
    }),
  );

  /** 停用要先確認(連動整棵子樹);啟用只影響自己這一節,直接送出。 */
  const handleToggleModule = (enabled: boolean) => {
    if (data.selectedModule === null) {
      return;
    }
    setActionError(null);
    if (enabled) {
      setModuleEnabled.mutate({
        input: { id: data.selectedModule.id, enabled: true },
      });
      return;
    }
    setIsDisableOpen(true);
  };

  const handleChangeIcon = (icon: ModuleIconKey) => {
    if (data.selectedModule === null) {
      return;
    }
    setActionError(null);
    setModuleIcon.mutate({ input: { id: data.selectedModule.id, icon } });
  };

  const handleTogglePermission = (
    permission: ModuleAdminPermissionLike,
    enabled: boolean,
  ) => {
    setActionError(null);
    setPendingPermissionId(permission.id);
    setPermissionEnabled.mutate({ input: { id: permission.id, enabled } });
  };

  /** 彈窗自己會顯示錯誤;彈窗沒開時才由頁面頂端的 Alert 接手。 */
  const pageError = isDisableOpen ? null : actionError;

  return (
    // 撐滿殼給的內容區高度(STYLE-08 / Figma 89:214:左右兩塊等高、各自內部捲動)
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <Alert severity="warning" sx={{ flex: 1 }}>
          {t("seedNotice")}
        </Alert>
        <Button
          variant="outlined"
          onClick={() => {
            setDialog("retired");
          }}
        >
          {t("retired.open")}
        </Button>
      </Stack>
      {pageError !== null && (
        <Alert severity="error">{t(`errors.${pageError}`)}</Alert>
      )}

      <Stack
        direction="row"
        spacing={{ xs: 0, sm: 3 }}
        sx={{ flex: 1, minHeight: 0 }}
      >
        {/* sm 以上這層不參與排版(contents,仍標 minHeight: 0 守 STYLE-08 高度鏈);手機寬依選取只顯示一邊,另一邊藏起來但不卸載 */}
        <Box
          sx={
            isMobile
              ? {
                  display: isDetailShown ? "none" : "flex",
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }
              : { display: "contents", minHeight: 0 }
          }
        >
          <ModuleTreePanel
            nodes={data.nodes}
            isLoading={data.isLoading}
            selectedModuleId={
              isMobile ? urlPickedModuleId : data.selectedModuleId
            }
            onSelectModule={data.selectModule}
          />
        </Box>
        <Box
          sx={
            isMobile
              ? {
                  display: isDetailShown ? "flex" : "none",
                  flexDirection: "column",
                  gap: 1,
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }
              : { display: "contents", minHeight: 0 }
          }
        >
          {isMobile && (
            <Box>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  data.selectModule(null);
                }}
              >
                {t("mobileBack")}
              </Button>
            </Box>
          )}
          <ModuleDetailPanel
            module={data.selectedModule}
            isLoading={data.isLoading}
            canToggleEnabled={data.canToggleEnabled}
            canSetIcon={data.canSetIcon}
            isModulePending={setModuleEnabled.isPending}
            isIconPending={setModuleIcon.isPending}
            pendingPermissionId={pendingPermissionId}
            onToggleModule={handleToggleModule}
            onChangeIcon={handleChangeIcon}
            onTogglePermission={handleTogglePermission}
            canEditListColumns={hasPermission(LIST_COLUMNS_PERMISSION)}
            onEditListColumns={() => {
              setIsListColumnsOpen(true);
            }}
          />
        </Box>
      </Stack>

      {isListColumnsOpen && data.selectedModule !== null && (
        <Suspense fallback={null}>
          <LazyListColumnsDialog
            moduleKey={data.selectedModule.key}
            moduleName={data.selectedModule.name}
            onClose={() => {
              setIsListColumnsOpen(false);
            }}
          />
        </Suspense>
      )}
      {isRetiredOpen && (
        <Suspense fallback={null}>
          <LazyRetiredPermissionsDialog
            canDelete={hasPermission(
              MODULE_MANAGER_PERMISSIONS.deleteRetiredPermission,
            )}
            onClose={() => {
              setDialog("none");
            }}
          />
        </Suspense>
      )}
      {isDisableOpen && data.selectedModule !== null && (
        <DisableModuleDialog
          module={data.selectedModule}
          isSubmitting={setModuleEnabled.isPending}
          errorCode={actionError}
          onCancel={() => {
            setIsDisableOpen(false);
            setActionError(null);
          }}
          onConfirm={() => {
            setActionError(null);
            setModuleEnabled.mutate({
              input: { id: data.selectedModule?.id ?? "", enabled: false },
            });
          }}
        />
      )}
    </Stack>
  );
};
