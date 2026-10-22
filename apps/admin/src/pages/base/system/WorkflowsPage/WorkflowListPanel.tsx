import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { WorkflowFieldsFragment } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

export interface WorkflowListPanelProps {
  workflows: readonly WorkflowFieldsFragment[];
  isLoading: boolean;
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  /** 清單區塊的 id(平板寬收起 / 展開鈕的 `aria-controls`) */
  id?: string;
  /** 標頭右端的 [收起](平板寬才有,`DesignerListCollapseButton`) */
  collapseButton?: ReactNode;
}

/**
 * 流程管理左欄:共用 / 客製、分派狀態(root 看分派給幾個租戶)、版本號、
 * 綁了哪些表單(租戶看本租戶的綁定)、發布中斷、有草稿。範圍由 api 決定。
 */
export const WorkflowListPanel = ({
  workflows,
  isLoading,
  keyword,
  onKeywordChange,
  selectedKey,
  onSelect,
  canCreate,
  onCreate,
  id,
  collapseButton,
}: WorkflowListPanelProps) => {
  const t = useTranslations("admin.workflows.list");

  return (
    <Card
      component="section"
      id={id}
      aria-label={t("region")}
      sx={{
        // 手機寬(主從一次只顯示一邊)清單滿版
        width: { xs: "100%", sm: 320 },
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Stack spacing={1.5} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {canCreate && (
            <Button size="small" onClick={onCreate}>
              {t("create")}
            </Button>
          )}
          {collapseButton}
        </Stack>
        <TextField
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          size="small"
          value={keyword}
          onChange={(event) => {
            onKeywordChange(event.target.value);
          }}
        />
      </Stack>
      {isLoading ? (
        <Stack sx={{ alignItems: "center", py: 3 }}>
          <CircularProgress aria-label={t("loading")} />
        </Stack>
      ) : (
        <List
          aria-label={t("region")}
          sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
        >
          {workflows.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
              {t("empty")}
            </Typography>
          )}
          {workflows.map((workflow) => (
            <ListItemButton
              key={workflow.key}
              selected={workflow.key === selectedKey}
              onClick={() => {
                onSelect(workflow.key);
              }}
            >
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                {/* ListItemText 自帶上下 6px margin;Stack 用 gap 後不再被歸零,這裡歸零維持列高 */}
                <ListItemText
                  primary={workflow.name}
                  secondary={workflow.key}
                  sx={{ my: 0 }}
                />
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
                  <Tag
                    tone={workflow.isShared ? "primary" : "grey"}
                    label={workflow.isShared ? t("shared") : t("custom")}
                  />
                  <Tag
                    tone={
                      workflow.currentVersion === null ||
                      workflow.currentVersion === undefined
                        ? "warning"
                        : "success"
                    }
                    label={
                      workflow.currentVersion === null ||
                      workflow.currentVersion === undefined
                        ? t("noVersion")
                        : t("version", { version: workflow.currentVersion })
                    }
                  />
                  {workflow.assignments.length > 0 && (
                    <Tag
                      tone="grey"
                      label={t("assigned", {
                        count: workflow.assignments.length,
                      })}
                    />
                  )}
                  {workflow.hasDraft && (
                    <Tag tone="grey" label={t("hasDraft")} />
                  )}
                </Stack>
                {workflow.boundForms.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {t("boundForms", {
                      forms: workflow.boundForms
                        .map((form) => form.formName ?? form.formKey)
                        .join("、"),
                    })}
                  </Typography>
                )}
              </Stack>
            </ListItemButton>
          ))}
        </List>
      )}
    </Card>
  );
};
