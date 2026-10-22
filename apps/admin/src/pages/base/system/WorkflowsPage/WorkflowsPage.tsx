import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useUrlEdit, useUrlEditGuard } from "@/hooks/base/useUrlEdit";
import { useUrlSelectedId } from "@/hooks/base/useUrlSelectedId";
import { useWorkflowDraftStore } from "@/stores/base/useWorkflowDraftStore";

import {
  WORKFLOWS_BLOCKED_PAGE_KEY,
  WORKFLOWS_PERMISSIONS,
} from "../workflows-permissions";
import { UnsavedWorkflowDialog } from "./UnsavedWorkflowDialog";
import { WorkflowDetailPanel } from "./WorkflowDetailPanel";
import { WorkflowNameDialog } from "./WorkflowDialogs/WorkflowNameDialog";
import { WorkflowListPanel } from "./WorkflowListPanel";
import { WorkflowMobileSummary } from "./WorkflowMobileSummary";
import { useWorkflowsPageData } from "./useWorkflowsPageData";

/** 從表單管理「建客製流程」捷徑帶來的路由 state:一進來就選中那個流程並打開 fork 跳窗。 */
export interface WorkflowsPageLocationState {
  forkWorkflowKey?: string;
}

/**
 * 流程管理(模組 key `system.workflows`,正本 `docs/modules/workflows.md`):
 * 左欄流程清單,右欄選中流程的設計器與版本面板;分派、fork、改名稱是右欄的跳窗;
 * 頁首「阻擋清單」進隱藏頁 `system.workflows.blocked-page`(有 `reassign` 才看得到)。
 *
 * root 管共用流程,租戶管理員管自己的客製流程(也可以直接建);分派來的共用流程只能看、只能以它為基底建。
 *
 * **手機寬(< `sm`)一次只顯示一邊,而且不提供設計**:網址沒有選取(`?detail=` / `?edit=`)時清單滿版;
 * 點一個流程 → 只顯示它的基本資料與摘要(`WorkflowMobileSummary`,唯讀)與「請用平板或電腦設計、編輯」的提示,
 * 設計器不掛載。頂部 [← 返回] 清掉選取回到清單(清單藏起來不卸載,搜尋與捲動都留著)。
 */
export const WorkflowsPage = () => {
  const t = useTranslations("admin.workflows");
  const navigate = useNavigate();
  const location = useLocation();
  const forkKey =
    (location.state as WorkflowsPageLocationState | null)?.forkWorkflowKey ??
    null;
  const { hasPermission } = usePermissions();
  const routeOf = useModuleRoutes();
  /**
   * 編輯彈窗記在網址 `?edit=<key>`(REACT-14):編的就是右欄選中的那一個,所以網址上的 key 同時是選中的;
   * 清單查完還沒有 → 提示找不到,沒有編輯權限(`abilities.canEdit`)→ 停在它的詳情。
   */
  const edit = useUrlEdit();
  const data = useWorkflowsPageData(forkKey, edit.requestedId);
  const selectItem = data.select;
  const keepDetail = useCallback(
    (key: string) => {
      selectItem(key);
    },
    [selectItem],
  );
  const editingKey = useUrlEditGuard({
    edit,
    canEdit:
      data.selected !== null && data.selected.key === edit.requestedId
        ? data.selected.abilities.canEdit
        : undefined,
    isMissing:
      edit.requestedId !== null &&
      data.isListSettled &&
      data.selectedKey !== edit.requestedId,
    onNoPermission: keepDetail,
  });
  /** 關掉編輯彈窗:停在剛編的那一個(網址 `?detail=` 記下它) */
  const closeEdit = () => {
    if (editingKey !== null) {
      selectItem(editingKey);
    }
    edit.close();
  };
  const [isCreating, setIsCreating] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const isDirty = useWorkflowDraftStore(
    (state) => state.isDirty && state.workflowKey === data.selectedKey,
  );
  const saveDraft = useWorkflowDraftStore((state) => state.save);
  const blockedRoute = routeOf(WORKFLOWS_BLOCKED_PAGE_KEY);
  const isMobile = useBreakpointDown("sm");
  const [urlPickedKey, setUrlPickedKey] = useUrlSelectedId();
  const isDetailShown = urlPickedKey !== null || edit.requestedId !== null;

  /** 換流程:設計器有未存的變更就先問(留下 / 放棄 / 先存),不讓右欄一換就把改動丟掉。 */
  const requestSelect = (key: string) => {
    // 手機寬沒有網址選取時,預設選中的那一筆也要點得進去
    if (key === data.selectedKey && urlPickedKey !== null) {
      return;
    }
    if (isDirty) {
      setPendingKey(key);
      return;
    }
    data.select(key);
  };

  const emptyText =
    data.isLoading || data.isSelectionPending ? t("loading") : t("empty");
  /** sm 以上的右欄(手機寬改由 `WorkflowMobileSummary` 顯示唯讀摘要) */
  const desktopDetail =
    data.selected === null ? (
      <Card sx={{ flex: 1, p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      </Card>
    ) : (
      <WorkflowDetailPanel
        key={data.selected.key}
        workflow={data.selected}
        isEditing={editingKey === data.selected.key}
        onEdit={edit.open}
        onEditClose={closeEdit}
        isForkRequested={data.selected.key === forkKey}
        onChanged={() => {
          void data.invalidate(data.selectedKey);
        }}
        onForked={(workflowKey) => {
          void data.invalidate(workflowKey);
          data.select(workflowKey);
        }}
      />
    );

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      {blockedRoute !== null &&
        hasPermission(WORKFLOWS_PERMISSIONS.reassign) && (
          <Stack direction="row" sx={{ alignItems: "center" }}>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              onClick={() => {
                void navigate(blockedRoute);
              }}
            >
              {t("blockedLink")}
            </Button>
          </Stack>
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
          <WorkflowListPanel
            workflows={data.workflows}
            isLoading={data.isLoading}
            keyword={data.keyword}
            onKeywordChange={data.setKeyword}
            selectedKey={isMobile ? urlPickedKey : data.selectedKey}
            onSelect={requestSelect}
            canCreate={hasPermission(WORKFLOWS_PERMISSIONS.create)}
            onCreate={() => {
              setIsCreating(true);
            }}
          />
        </Box>
        {isMobile ? (
          <WorkflowMobileSummary
            workflow={data.selected}
            emptyText={emptyText}
            isShown={isDetailShown}
            onBack={() => {
              edit.close();
              setUrlPickedKey(null);
            }}
          />
        ) : (
          desktopDetail
        )}
      </Stack>
      {pendingKey !== null && (
        <UnsavedWorkflowDialog
          onStay={() => {
            setPendingKey(null);
          }}
          onDiscard={() => {
            data.select(pendingKey);
            setPendingKey(null);
          }}
          onSaveAndLeave={async () => {
            const isSaved = saveDraft === null || (await saveDraft()) !== null;
            if (isSaved) {
              data.select(pendingKey);
            }
            setPendingKey(null);
            return isSaved;
          }}
        />
      )}
      {isCreating && (
        <WorkflowNameDialog
          onClose={() => {
            setIsCreating(false);
          }}
          onSaved={(workflowKey) => {
            setIsCreating(false);
            void data.invalidate(workflowKey);
            data.select(workflowKey);
          }}
        />
      )}
    </Stack>
  );
};
