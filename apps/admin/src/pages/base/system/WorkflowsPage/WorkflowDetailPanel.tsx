import { useState } from "react";
import { useTranslations } from "use-intl";

import type { WorkflowFieldsFragment } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

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
}

type DetailTab = "design" | "versions";
type OpenDialog = "edit" | "fork" | "assign" | null;

/**
 * 流程管理右欄(Spec 6b §8 畫面 2–5 的右側):流程資料、設計 / 版本兩個頁籤,以及改名稱、
 * 以此為基底建流程(fork)、分派租戶(root)。按鈕一律依 api 的 `workflow.abilities`。
 */
export const WorkflowDetailPanel = ({
  workflow,
  isForkRequested,
  onChanged,
  onForked,
}: WorkflowDetailPanelProps) => {
  const t = useTranslations("admin.workflows.detail");
  const [tab, setTab] = useState<DetailTab>("design");
  /** 版本面板「檢視 vN」:設計頁籤換成唯讀檢視,草稿的設計器照樣掛著(未存變更不丟) */
  const [viewing, setViewing] = useState<number | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(() =>
    isForkRequested && workflow.abilities.canFork ? "fork" : null,
  );

  return (
    <Card
      component="section"
      aria-label={t("region")}
      sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", p: 3 }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
        >
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" component="h1">
              {workflow.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("meta", {
                key: workflow.key,
                kind: workflow.isShared ? t("shared") : t("custom"),
              })}
            </Typography>
            {workflow.forkedFrom !== null &&
              workflow.forkedFrom !== undefined && (
                <Typography variant="body2" color="text.secondary">
                  {t("forkedFrom", {
                    key: workflow.forkedFrom.workflowKey,
                    version: workflow.forkedFrom.version,
                  })}
                </Typography>
              )}
          </Stack>
          {workflow.abilities.canEdit && (
            <Button
              variant="text"
              onClick={() => {
                setDialog("edit");
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
        {workflow.assignments.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("assignedTo", {
              tenants: workflow.assignments
                .map((item) => item.tenantName ?? item.tenantOrgId)
                .join("、"),
            })}
          </Typography>
        )}
        {workflow.boundForms.length > 0 && (
          <Typography variant="body2" color="text.secondary">
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
      {dialog === "edit" && (
        <WorkflowNameDialog
          workflow={workflow}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={() => {
            setDialog(null);
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
