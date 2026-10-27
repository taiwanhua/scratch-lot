import { useState } from "react";
import { useTranslations } from "use-intl";

import type { WorkflowFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

import { useDesignerDrawerStore } from "@/stores/base/useDesignerDrawerStore";

import {
  designerDrawerReserve,
  detailHeaderActionsSx,
  detailHeaderTitleSx,
} from "../designer-layout";
import { FlowVersionViewer } from "./WorkflowDesigner/FlowVersionViewer";
import { WorkflowDesigner } from "./WorkflowDesigner/WorkflowDesigner";
import { AssignWorkflowDialog } from "./WorkflowDialogs/AssignWorkflowDialog";
import { ForkWorkflowDialog } from "./WorkflowDialogs/ForkWorkflowDialog";
import { WorkflowNameDialog } from "./WorkflowDialogs/WorkflowNameDialog";
import { WorkflowVersionPanel } from "./WorkflowVersionPanel/WorkflowVersionPanel";

export interface WorkflowDetailPanelProps {
  workflow: WorkflowFieldsFragment;
  /** 從表單管理「建客製流程」捷徑進來:一打開就是「以此為基底建流程」跳窗 */
  isForkRequested: boolean;
  onChanged: () => void;
  onForked: (workflowKey: string) => void;
  /** 編輯彈窗開著(網址 `?edit=<key>`,由頁面保管) */
  isEditing: boolean;
  /** 按「編輯」:頁面把 `?edit=<key>` 寫進網址 */
  onEdit: (key: string) => void;
  /** 關掉編輯彈窗(取消、存完) */
  onEditClose: () => void;
}

type DetailTab = "design" | "versions";
/** 不進網址的彈窗(fork、分派);編輯彈窗在網址 `?edit=`(頁面保管) */
type OpenDialog = "fork" | "assign" | null;

/**
 * 流程管理右欄:流程資料、設計 / 版本兩個頁籤,以及改名稱、
 * 以此為基底建流程(fork)、分派租戶(root)。按鈕一律依 api 的 `workflow.abilities`。
 */
export const WorkflowDetailPanel = ({
  workflow,
  isForkRequested,
  onChanged,
  onForked,
  isEditing,
  onEdit,
  onEditClose,
}: WorkflowDetailPanelProps) => {
  const t = useTranslations("admin.workflows.detail");
  const [tab, setTab] = useState<DetailTab>("design");
  /** 版本面板「檢視 vN」:設計頁籤換成唯讀檢視,草稿的設計器照樣掛著(未存變更不丟) */
  const [viewing, setViewing] = useState<number | null>(null);
  /** 平板寬:設計器 / 唯讀版本檢視的屬性抽屜開著(卡片讓出抽屜寬;只看目前顯示的那一個) */
  const isDesignerDrawerOpen = useDesignerDrawerStore(
    (state) => state.open.designer,
  );
  const isViewerDrawerOpen = useDesignerDrawerStore(
    (state) => state.open.viewer,
  );
  const isDrawerShown =
    tab === "design" &&
    (viewing === null ? isDesignerDrawerOpen : isViewerDrawerOpen);
  const [dialog, setDialog] = useState<OpenDialog>(() =>
    isForkRequested && workflow.abilities.canFork ? "fork" : null,
  );

  return (
    <Card
      component="section"
      aria-label={t("region")}
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: "auto",
        p: 3,
        // 平板寬屬性抽屜開著:整張卡片(含工具列的 [存草稿])縮到抽屜左邊
        ...(isDrawerShown && {
          pr: (theme) => designerDrawerReserve(theme.spacing),
        }),
      }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
        >
          {/* 標題欄以內容寬為底:放不下時操作鈕整組換到下一列,不把標題擠扁(`designer-layout.ts`) */}
          <Stack spacing={0.5} sx={detailHeaderTitleSx}>
            <Typography variant="h6" component="h1">
              {workflow.name}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {t("meta", {
                key: workflow.key,
                kind: workflow.isShared ? t("shared") : t("custom"),
              })}
            </Typography>
            {workflow.forkedFrom !== null &&
              workflow.forkedFrom !== undefined && (
                <Typography variant="body2" color="textSecondary">
                  {t("forkedFrom", {
                    key: workflow.forkedFrom.workflowKey,
                    version: workflow.forkedFrom.version,
                  })}
                </Typography>
              )}
          </Stack>
          <Stack direction="row" spacing={1} sx={detailHeaderActionsSx}>
            {workflow.abilities.canEdit && (
              <Button
                variant="text"
                onClick={() => {
                  onEdit(workflow.key);
                }}
              >
                {t("edit")}
              </Button>
            )}
            {workflow.abilities.canFork && (
              <Button
                variant="outlined"
                onClick={() => {
                  setDialog("fork");
                }}
              >
                {t("fork")}
              </Button>
            )}
            {workflow.abilities.canAssign && (
              <Button
                variant="outlined"
                onClick={() => {
                  setDialog("assign");
                }}
              >
                {t("assign")}
              </Button>
            )}
          </Stack>
        </Stack>
        {workflow.assignments.length > 0 && (
          <Typography variant="body2" color="textSecondary">
            {t("assignedTo", {
              tenants: workflow.assignments
                .map((item) => item.tenantName ?? item.tenantOrgId)
                .join("、"),
            })}
          </Typography>
        )}
        {workflow.boundForms.length > 0 && (
          <Typography variant="body2" color="textSecondary">
            {t("boundForms", {
              forms: workflow.boundForms
                .map((form) => form.formName ?? form.formKey)
                .join("、"),
            })}
          </Typography>
        )}
        <Tabs
          aria-label={t("tabs")}
          value={tab}
          onChange={(next) => {
            setTab(next === "versions" ? "versions" : "design");
          }}
          items={[
            { value: "design", label: t("tabDesign") },
            { value: "versions", label: t("tabVersions") },
          ]}
        />
        {/* 兩個頁籤都保持掛載、只切顯示:切到「版本」不能讓設計器卸載(未存的改動會無聲消失) */}
        <Box hidden={tab !== "design"}>
          {viewing !== null && (
            <FlowVersionViewer
              key={viewing}
              workflow={workflow}
              version={viewing}
              onClose={() => {
                setViewing(null);
              }}
              onChanged={onChanged}
            />
          )}
          <Box hidden={viewing !== null}>
            <WorkflowDesigner workflow={workflow} onChanged={onChanged} />
          </Box>
        </Box>
        <Box hidden={tab !== "versions"}>
          <WorkflowVersionPanel
            workflow={workflow}
            onChanged={onChanged}
            onView={(version) => {
              setViewing(version);
              setTab("design");
            }}
          />
        </Box>
      </Stack>
      {isEditing && (
        <WorkflowNameDialog
          workflow={workflow}
          onClose={() => {
            onEditClose();
          }}
          onSaved={() => {
            onEditClose();
            onChanged();
          }}
        />
      )}
      {dialog === "fork" && (
        <ForkWorkflowDialog
          source={workflow}
          onClose={() => {
            setDialog(null);
          }}
          onForked={(workflowKey) => {
            setDialog(null);
            onForked(workflowKey);
          }}
        />
      )}
      {dialog === "assign" && (
        <AssignWorkflowDialog
          workflow={workflow}
          onClose={() => {
            setDialog(null);
          }}
          onChanged={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
};
