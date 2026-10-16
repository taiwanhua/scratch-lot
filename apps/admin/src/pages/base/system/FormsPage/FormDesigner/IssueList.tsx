import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { List, ListItemButton, ListItemText } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type {
  DesignerIssue,
  DesignerReport,
} from "@/lib/base/form-engine/designer-issues";

import type { RegexCheckStatus } from "./useRegexSafety";

export interface IssueListProps {
  report: DesignerReport;
  regexStatus: RegexCheckStatus;
  /** 點一筆 → 定位(有欄位就選那個欄位;摘要槽 / 帶入規則 / 版面格就回到表單設定) */
  onLocate: (issue: DesignerIssue) => void;
}

/**
 * 檢查結果(Spec 6a §5「定義檢查器」):**有錯不能發布、警告可發布**;每筆帶定位,點擊定位到
 * 欄位 / 表達式節點 / 版面格。
 */
export const IssueList = ({
  report,
  regexStatus,
  onLocate,
}: IssueListProps) => {
  const t = useTranslations("admin.forms.designer");
  const issues = [
    ...report.errors.map((issue) => ({ issue, isError: true })),
    ...report.warnings.map((issue) => ({ issue, isError: false })),
  ];

  return (
    <Stack component="section" aria-label={t("issues")} spacing={0.5}>
      <Typography variant="subtitle2">
        {t("issueSummary", {
          errors: report.errors.length,
          warnings: report.warnings.length,
        })}
      </Typography>
      {regexStatus === "checking" && (
        <Typography variant="caption" color="text.secondary">
          {t("regexChecking")}
        </Typography>
      )}
      {regexStatus === "failed" && (
        <Alert severity="warning">{t("regexUnavailable")}</Alert>
      )}
      {issues.length > 0 && (
        <List dense aria-label={t("issues")}>
          {issues.map(({ issue, isError }, index) => (
            <ListItemButton
              key={`${issue.code}-${String(index)}`}
              onClick={() => {
                onLocate(issue);
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
      )}
    </Stack>
  );
};
