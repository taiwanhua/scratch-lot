import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useWorkflowDraftStore } from "@/stores/base/useWorkflowDraftStore";

import {
  WORKFLOWS_BLOCKED_PAGE_KEY,
  WORKFLOWS_PERMISSIONS,
} from "../workflows-permissions";
import { UnsavedWorkflowDialog } from "./UnsavedWorkflowDialog";
import { WorkflowDetailPanel } from "./WorkflowDetailPanel";
import { WorkflowNameDialog } from "./WorkflowDialogs/WorkflowNameDialog";
import { WorkflowListPanel } from "./WorkflowListPanel";
import { useWorkflowsPageData } from "./useWorkflowsPageData";

/** 從表單管理「建客製流程」捷徑帶來的路由 state:一進來就選中那個流程並打開 fork 跳窗。 */
export interface WorkflowsPageLocationState {
  forkWorkflowKey?: string;
}

/**
 * 流程管理(模組 key `system.workflows`,正本 `docs/modules/workflows.md`;Spec 6b §8 畫面 2–6):
 * 左欄流程清單,右欄選中流程的設計器與版本面板;分派、fork、改名稱是右欄的跳窗;
 * 頁首「阻擋清單」進隱藏頁 `system.workflows.blocked-page`(有 `reassign` 才看得到)。
 *
 * root 管共用流程,租戶管理員管自己的客製流程(也可以直接建);分派來的共用流程只能看、只能以它為基底建。
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
  const data = useWorkflowsPageData(forkKey);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const isDirty = useWorkflowDraftStore(
    (state) => state.isDirty && state.workflowKey === data.selectedKey,
  );
  const saveDraft = useWorkflowDraftStore((state) => state.save);
  const blockedRoute = routeOf(WORKFLOWS_BLOCKED_PAGE_KEY);

  /** 換流程:設計器有未存的變更就先問(留下 / 放棄 / 先存),不讓右欄一換就把改動丟掉。 */
  const requestSelect = (key: string) => {
    if (key === data.selectedKey) {
      return;
    }
    if (isDirty) {
      setPendingKey(key);
      return;
    }
    data.select(key);
  };

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
      <Stack direction="row" spacing={3} sx={{ flex: 1, minHeight: 0 }}>
        <WorkflowListPanel
          workflows={data.workflows}
          isLoading={data.isLoading}
          keyword={data.keyword}
          onKeywordChange={data.setKeyword}
          selectedKey={data.selectedKey}
          onSelect={requestSelect}
          canCreate={hasPermission(WORKFLOWS_PERMISSIONS.create)}
          onCreate={() => {
            setIsCreating(true);
          }}
        />
        {data.selected === null ? (
          <Card sx={{ flex: 1, p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              {data.isLoading ? t("loading") : t("empty")}
            </Typography>
          </Card>
        ) : (
          <WorkflowDetailPanel
            key={data.selected.key}
            workflow={data.selected}
            isForkRequested={data.selected.key === forkKey}
            onChanged={() => {
              void data.invalidate(data.selectedKey);
            }}
            onForked={(workflowKey) => {
              void data.invalidate(workflowKey);
              data.select(workflowKey);
            }}
          />
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
