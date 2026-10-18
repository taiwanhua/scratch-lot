import { useTranslations } from "use-intl";

import type { WorkflowIssue } from "@repo/domain/workflow";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { isFlowCcIssue } from "@/lib/base/workflow/validation";

export interface FlowIssueListProps {
  errors: readonly WorkflowIssue[];
  warnings: readonly WorkflowIssue[];
  stepNameOf: (stepKey: string) => string;
  /**
   * 點一筆 → 選中它指到的關卡;整個流程的知會對象那幾筆 → `null`(取消選取,屬性面板回到「整個流程」);
   * 其他沒有關卡定位的(例如「流程至少一關」)不動
   */
  onLocate: (stepKey: string | null) => void;
}

/**
 * 定義檢查器的結果(前後端同一份 `validateWorkflowDefinition`,設計器即時跑):
 * 每筆標出是哪一關,點一下選中那一關。**有錯不能發布、警告可以**。
 */
export const FlowIssueList = ({
  errors,
  warnings,
  stepNameOf,
  onLocate,
}: FlowIssueListProps) => {
  const t = useTranslations("admin.workflows.issues");
  const all = [
    ...errors.map((issue) => ({ issue, isError: true })),
    ...warnings.map((issue) => ({ issue, isError: false })),
  ];

  return (
    <Stack component="section" aria-label={t("region")} spacing={0.5}>
      <Typography variant="subtitle2">
        {t("summary", { errors: errors.length, warnings: warnings.length })}
      </Typography>
      {all.length > 0 && (
        <List dense aria-label={t("region")}>
          {all.map(({ issue, isError }, index) => {
            const stepKey = issue.location.stepKey;
            const isFlowCc = isFlowCcIssue(issue);
            return (
              <ListItemButton
                key={`${issue.code}-${String(index)}`}
                disabled={stepKey === undefined && !isFlowCc}
                onClick={() => {
                  if (stepKey !== undefined) {
                    onLocate(stepKey);
                  } else if (isFlowCc) {
                    onLocate(null);
                  }
                }}
              >
                <ListItemText
                  primary={issue.message}
                  secondary={[
                    isError ? t("error") : t("warning"),
                    stepKey === undefined ? null : stepNameOf(stepKey),
                    issue.code,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                  slotProps={{
                    primary: { color: isError ? "error" : "warning.main" },
                  }}
                />
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Stack>
  );
};
