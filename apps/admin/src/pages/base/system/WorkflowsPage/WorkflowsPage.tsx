import { useCallback, useId, useState } from "react";
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

import { DesignerListCollapseButton } from "../DesignerListCollapseButton";
import { DesignerListRail } from "../DesignerListRail";
import { useDesignerListCollapse } from "../useDesignerListCollapse";
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
 * 例外:設計器有未存的變更時縮到手機寬,設計器藏起來但**不卸載**(草稿與「有未存的變更」都留著),
 * 摘要上方提示回到平板或電腦處理;換流程照樣經過未存攔截。
 *
 * **平板寬(`sm`–`lg`)畫布優先**:左清單一進來就收起成一條 [展開](`useDesignerListCollapse`),
 * 在清單裡選一個或按 [收起] 再收起;設計器的屬性面板改成右側抽屜(`FlowDesignerWorkspace`)。
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
  /**
   * 有未存變更時被攔下的離開:`key` 是要換過去的那一筆,null = 手機寬按 [← 返回] 回清單;
   * `isFromList` = 從清單點的(真的換過去後平板寬要收起清單)。
   */
  const [pending, setPending] = useState<{
    key: string | null;
    isFromList: boolean;
  } | null>(null);
  /**
   * 放棄變更時遞增,讓詳情以新的 key 重新掛載、丟掉草稿:手機寬返回清單時選取會退回預設那一筆,
   * 可能就是正在改的那一筆,只靠 key 不會重掛(同資料範圍頁)
   */
  const [detailGeneration, setDetailGeneration] = useState(0);
  const isDirty = useWorkflowDraftStore(
    (state) => state.isDirty && state.workflowKey === data.selectedKey,
  );
  const saveDraft = useWorkflowDraftStore((state) => state.save);
  const blockedRoute = routeOf(WORKFLOWS_BLOCKED_PAGE_KEY);
  const isMobile = useBreakpointDown("sm");
  const list = useDesignerListCollapse();
  const listId = useId();
  const [urlPickedKey, setUrlPickedKey] = useUrlSelectedId();
  const isDetailShown = urlPickedKey !== null || edit.requestedId !== null;

  /** 換流程:設計器有未存的變更就先問(留下 / 放棄 / 先存),不讓右欄一換就把改動丟掉。 */
  /** 真的離開:換到 `key`,或(null)手機寬回清單;從清單換過去的在平板寬收起清單 */
  const leave = (key: string | null, isFromList: boolean) => {
    if (key === null) {
      edit.close();
      setUrlPickedKey(null);
      return;
    }
    data.select(key);
    if (isFromList) {
      list.collapse();
    }
  };

  /**
   * 換一筆或返回清單:設計器有未存的變更就先問(留下 / 放棄 / 先存),不讓右欄一換就把改動丟掉。
   * 手機寬的 [← 返回] 也走這裡 —— 返回後選取會退回預設那一筆,正在改的那一筆會被重掛,草稿就沒了。
   */
  const requestLeave = (key: string | null, isFromList = false) => {
    // 同一筆不經過未存攔截(沒有要離開);網址還沒有選取時寫進去(手機寬才點得進預設那一筆)
    if (key !== null && key === data.selectedKey) {
      if (urlPickedKey === null) {
        data.select(key);
      }
      if (isFromList) {
        list.collapse();
      }
      return;
    }
    if (isDirty) {
      setPending({ key, isFromList });
      return;
    }
    leave(key, isFromList);
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
        key={`${data.selected.key}:${String(detailGeneration)}`}
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
        {/* sm 以上這層不參與排版(contents,仍標 minHeight: 0 守 STYLE-08 高度鏈);手機寬依選取只顯示一邊,另一邊藏起來但不卸載;平板寬收起時也是藏起來 */}
        <Box
          sx={
            isMobile
              ? {
                  display: isDetailShown ? "none" : "flex",
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                }
              : {
                  display: list.isCollapsed ? "none" : "contents",
                  minHeight: 0,
                }
          }
        >
          <WorkflowListPanel
            id={listId}
            workflows={data.workflows}
            isLoading={data.isLoading}
            keyword={data.keyword}
            onKeywordChange={data.setKeyword}
            selectedKey={isMobile ? urlPickedKey : data.selectedKey}
            onSelect={(key) => {
              requestLeave(key, true);
            }}
            canCreate={hasPermission(WORKFLOWS_PERMISSIONS.create)}
            onCreate={() => {
              setIsCreating(true);
            }}
            collapseButton={
              list.isTablet && (
                <DesignerListCollapseButton
                  label={t("list.collapse")}
                  listId={listId}
                  onCollapse={list.collapse}
                  buttonRef={list.collapseButtonRef}
                />
              )
            }
          />
        </Box>
        {list.isCollapsed && (
          <DesignerListRail
            label={t("list.expand")}
            listId={listId}
            onExpand={list.expand}
            buttonRef={list.expandButtonRef}
          />
        )}
        {isMobile && (
          <WorkflowMobileSummary
            workflow={data.selected}
            emptyText={emptyText}
            isShown={isDetailShown}
            hasUnsavedChanges={isDirty}
            onBack={() => {
              requestLeave(null);
            }}
          />
        )}
        {/* 手機寬不掛設計器;但有未存變更時(從平板 / 電腦縮過來)藏起來保留,不讓草稿無聲消失。位置固定,縮放視窗不重掛 */}
        {(!isMobile || isDirty) && (
          <Box
            sx={
              isMobile
                ? { display: "none" }
                : { display: "contents", minHeight: 0 }
            }
          >
            {desktopDetail}
          </Box>
        )}
      </Stack>
      {pending !== null && (
        <UnsavedWorkflowDialog
          onStay={() => {
            setPending(null);
          }}
          onDiscard={() => {
            leave(pending.key, pending.isFromList);
            setDetailGeneration((generation) => generation + 1);
            setPending(null);
          }}
          onSaveAndLeave={async () => {
            const isSaved = saveDraft === null || (await saveDraft()) !== null;
            if (isSaved) {
              leave(pending.key, pending.isFromList);
            }
            setPending(null);
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
