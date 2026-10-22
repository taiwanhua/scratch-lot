import { useTranslations } from "use-intl";

import type { WorkflowFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface WorkflowMobileSummaryProps {
  /** 選中的那一個;null = 還在載入或清單是空的 */
  workflow: WorkflowFieldsFragment | null;
  /** 沒有選中時顯示的文字(載入中 / 沒有資料) */
  emptyText: string;
  /** 網址上有選取:顯示這一邊(否則藏起來,清單那一邊滿版) */
  isShown: boolean;
  /** [← 返回]:清掉選取回清單 */
  onBack: () => void;
}

/** 摘要標籤欄的最小寬(theme.spacing 單位),讓各列的值對齊。 */
const LABEL_WIDTH = 12;

/** 摘要的一列:標籤 + 值(唯讀)。 */
const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" spacing={1.5}>
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ flexShrink: 0, minWidth: (theme) => theme.spacing(LABEL_WIDTH) }}
    >
      {label}
    </Typography>
    <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
      {value}
    </Typography>
  </Stack>
);

/**
 * 流程管理在手機寬(< `sm`)的詳情:只顯示基本資料與摘要(唯讀),並提示到平板或電腦設計、編輯 ——
 * 流程設計器需要寬畫面,手機上不提供(`WorkflowsPage`)。
 */
const WorkflowMobileSummaryCard = ({
  workflow,
}: {
  workflow: WorkflowFieldsFragment;
}) => {
  const t = useTranslations("admin.workflows");
  const version =
    workflow.currentVersion === null || workflow.currentVersion === undefined
      ? t("list.noVersion")
      : t("list.version", { version: workflow.currentVersion });

  return (
    <Card
      component="section"
      aria-label={t("mobile.region")}
      sx={{ flex: 1, minWidth: 0, p: 2.5 }}
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h6" component="h1">
            {workflow.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("detail.meta", {
              key: workflow.key,
              kind: workflow.isShared ? t("detail.shared") : t("detail.custom"),
            })}
          </Typography>
          {workflow.forkedFrom !== null &&
            workflow.forkedFrom !== undefined && (
              <Typography variant="body2" color="text.secondary">
                {t("detail.forkedFrom", {
                  key: workflow.forkedFrom.workflowKey,
                  version: workflow.forkedFrom.version,
                })}
              </Typography>
            )}
        </Stack>
        <Alert severity="info">{t("mobile.hint")}</Alert>
        <Stack spacing={1}>
          <SummaryRow
            label={t("mobile.version")}
            value={
              workflow.hasDraft ? `${version} · ${t("list.hasDraft")}` : version
            }
          />
          {workflow.assignments.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("detail.assignedTo", {
                tenants: workflow.assignments
                  .map((item) => item.tenantName ?? item.tenantOrgId)
                  .join("、"),
              })}
            </Typography>
          )}
          {workflow.boundForms.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("detail.boundForms", {
                forms: workflow.boundForms
                  .map((form) => form.formName ?? form.formKey)
                  .join("、"),
              })}
            </Typography>
          )}
        </Stack>
      </Stack>
    </Card>
  );
};

/**
 * 手機寬(< `sm`)主從頁的詳情那一邊(REACT-17):頂部 [← 返回] + 唯讀摘要;
 * 沒有選取時藏起來(不卸載),由清單那一邊滿版。
 */
export const WorkflowMobileSummary = ({
  workflow,
  emptyText,
  isShown,
  onBack,
}: WorkflowMobileSummaryProps) => {
  const t = useTranslations("admin.workflows");
  return (
    <Stack
      spacing={1}
      sx={{ display: isShown ? "flex" : "none", flex: 1, minWidth: 0 }}
    >
      <Box>
        <Button variant="text" size="small" onClick={onBack}>
          {t("mobileBack")}
        </Button>
      </Box>
      {workflow === null ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <WorkflowMobileSummaryCard workflow={workflow} />
      )}
    </Stack>
  );
};
