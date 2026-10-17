import { useTranslations } from "use-intl";

import type { WorkflowDefinition, WorkflowIssue } from "@repo/domain/workflow";
import { Alert } from "@repo/ui/alert";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { definitionFingerprint } from "@/lib/base/workflow/flow-model";
import { isFlowCcIssue } from "@/lib/base/workflow/validation";
import type { WorkflowError } from "@/lib/base/workflow/workflow-errors";

import type { FlowCheckResult } from "./useFlowCheck";

export interface FlowCheckPanelProps {
  result: FlowCheckResult;
  error: WorkflowError | null;
  /** 目前的定義(與檢查當時不同 → 提示重新檢查) */
  definition: WorkflowDefinition;
  checkFormKey: string | null;
  stepNameOf: (stepKey: string) => string;
  /** 點一筆 → 選中那一關並打開屬性面板;整個流程的知會對象那幾筆 → `null`(屬性面板回到「整個流程」) */
  onLocate: (stepKey: string | null) => void;
}

interface IssueRow {
  issue: WorkflowIssue;
  isError: boolean;
}

interface IssueGroup {
  /** null = 整個流程(沒有定位到關卡的,例如「流程至少一關」、結構問題) */
  stepKey: string | null;
  rows: IssueRow[];
}

/** 依關卡分組:照定義裡的關卡順序,整個流程的放最前面;每組錯誤在前、警告在後。 */
const groupsOf = (
  result: FlowCheckResult,
  definition: WorkflowDefinition,
): IssueGroup[] => {
  const rows: IssueRow[] = [
    ...result.report.errors.map((issue) => ({ issue, isError: true })),
    ...result.report.warnings.map((issue) => ({ issue, isError: false })),
  ];
  const order = [
    null,
    ...definition.steps.map((step) => step.key),
    ...rows
      .map((row) => row.issue.location.stepKey)
      .filter((key): key is string => key !== undefined),
  ];
  return [...new Set(order)]
    .map((stepKey) => ({
      stepKey,
      rows: rows.filter(
        (row) => (row.issue.location.stepKey ?? null) === stepKey,
      ),
    }))
    .filter((group) => group.rows.length > 0);
};

/**
 * 「檢查」的結果面板(和表單設計器的檢查結果同一種列法):依關卡列出錯誤 / 警告,點一筆定位到那一關
 * (選取節點 + 打開屬性面板)。沒選檢查用表單時提示欄位類檢查沒做 —— 結構類檢查照跑。
 */
export const FlowCheckPanel = ({
  result,
  error,
  definition,
  checkFormKey,
  stepNameOf,
  onLocate,
}: FlowCheckPanelProps) => {
  const t = useTranslations("admin.workflows.check");
  const tErrors = useTranslations("admin.workflows.errors");
  const groups = groupsOf(result, definition);
  const isStale =
    result.fingerprint !== definitionFingerprint(definition) ||
    result.checkFormKey !== checkFormKey;

  return (
    <Stack component="section" aria-label={t("region")} spacing={1}>
      <Typography variant="subtitle2" component="h2">
        {t("title")}
      </Typography>
      {error !== null && (
        <Alert severity="warning">
          {t("serverFailed", { reason: tErrors(error.code) })}
        </Alert>
      )}
      {!result.hasCheckForm && (
        <Alert severity="info">{t("noCheckForm")}</Alert>
      )}
      {isStale && <Alert severity="info">{t("stale")}</Alert>}
      <Typography variant="body2">
        {groups.length === 0
          ? t("passed")
          : t("summary", {
              errors: result.report.errors.length,
              warnings: result.report.warnings.length,
            })}
      </Typography>
      {groups.map((group) => (
        <Stack key={group.stepKey ?? ""} spacing={0.25}>
          <Typography variant="body2" color="text.secondary" component="h3">
            {group.stepKey === null
              ? t("wholeFlow")
              : t("step", { name: stepNameOf(group.stepKey) })}
          </Typography>
          <List
            dense
            aria-label={
              group.stepKey === null
                ? t("wholeFlow")
                : t("stepIssues", { name: stepNameOf(group.stepKey) })
            }
          >
            {group.rows.map(({ issue, isError }, index) => (
              <ListItemButton
                key={`${issue.code}-${String(index)}`}
                disabled={group.stepKey === null && !isFlowCcIssue(issue)}
                onClick={() => {
                  onLocate(group.stepKey);
                }}
              >
                <ListItemText
                  primary={issue.message}
                  secondary={`${isError ? t("error") : t("warning")} · ${issue.code}`}
                  slotProps={{
                    primary: {
                      color: isError ? "error" : "warning.main",
                      variant: "body2",
                    },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Stack>
      ))}
    </Stack>
  );
};
