import { useTranslations } from "use-intl";

import type { JoinStepDef } from "@repo/domain/workflow";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

export interface JoinPanelProps {
  join: JoinStepDef;
  branchCount: number;
  issues: readonly string[];
  onRename: (name: string) => void;
  onAddBranch: () => void;
  onInsertAfter: () => void;
  onRemoveParallel: () => void;
  /** 唯讀檢視舊版本:名稱不能改、沒有操作鈕 */
  isReadonly?: boolean;
}

/**
 * 匯合節點的面板:它是**系統節點**,沒有審核者、會簽、跳過條件、退回可設 —— 等所有分支都通過
 * (或依規則跳過)就自動完成。能做的只有改名稱、多加一條分支、在匯合後接關卡、刪掉整組分流。
 */
export const JoinPanel = ({
  join,
  branchCount,
  issues,
  onRename,
  onAddBranch,
  onInsertAfter,
  onRemoveParallel,
  isReadonly = false,
}: JoinPanelProps) => {
  const t = useTranslations("admin.workflows.join");

  return (
    <Stack
      spacing={2}
      component="section"
      aria-label={t("region", { name: join.name })}
    >
      <Typography variant="subtitle1" component="h2">
        {t("title")}
      </Typography>
      <Typography variant="body2" color="textSecondary">
        {t("body", { count: branchCount })}
      </Typography>
      <TextField
        label={t("name")}
        value={join.name}
        size="small"
        disabled={isReadonly}
        onChange={(event) => {
          onRename(event.target.value);
        }}
      />
      {issues.map((message) => (
        <Typography key={message} variant="caption" color="error">
          {message}
        </Typography>
      ))}
      {!isReadonly && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button size="small" variant="outlined" onClick={onAddBranch}>
            {t("addBranch")}
          </Button>
          <Button size="small" variant="outlined" onClick={onInsertAfter}>
            {t("insertAfter")}
          </Button>
          <Button
            size="small"
            variant="text"
            color="error"
            onClick={onRemoveParallel}
          >
            {t("removeParallel")}
          </Button>
        </Stack>
      )}
    </Stack>
  );
};
