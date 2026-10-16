import type {
  WorkflowIssue,
  WorkflowIssueCode,
  WorkflowValidationReport,
} from "@repo/domain/workflow";

/** GraphQL 的檢查結果一筆(`WorkflowValidationFields`;定位欄位攤平、沒有的是 null)。 */
export interface RemoteWorkflowIssue {
  code: string;
  message: string;
  stepKey?: string | null;
  stepIndex?: number | null;
  edgeIndex?: number | null;
  property?: string | null;
  exprPath?: string | null;
}

const toIssue = (issue: RemoteWorkflowIssue): WorkflowIssue => ({
  code: issue.code as WorkflowIssueCode,
  message: issue.message,
  location: {
    ...(issue.stepKey !== null &&
      issue.stepKey !== undefined && { stepKey: issue.stepKey }),
    ...(issue.stepIndex !== null &&
      issue.stepIndex !== undefined && { stepIndex: issue.stepIndex }),
    ...(issue.edgeIndex !== null &&
      issue.edgeIndex !== undefined && { edgeIndex: issue.edgeIndex }),
    ...(issue.property !== null &&
      issue.property !== undefined && { property: issue.property }),
  },
});

const idOf = (issue: WorkflowIssue): string =>
  `${issue.code}:${issue.location.stepKey ?? ""}`;

/**
 * 設計器即時檢查(前端 `validateWorkflowDefinition`,只拿得到部分目錄)+ 上次存草稿時 api 回的結果
 * (api 有完整目錄:本租戶使用者、表單欄位)合併,同一關同一種問題只列一次。
 * api 的結果只在「存完之後沒再改過」時才併進來,改過就以即時檢查為準。
 */
export const mergeReports = (
  local: WorkflowValidationReport,
  remote: {
    errors: readonly RemoteWorkflowIssue[];
    warnings: readonly RemoteWorkflowIssue[];
  } | null,
): WorkflowValidationReport => {
  if (remote === null) {
    return local;
  }
  const merge = (
    mine: readonly WorkflowIssue[],
    theirs: readonly RemoteWorkflowIssue[],
  ): WorkflowIssue[] => {
    const seen = new Set(mine.map((issue) => idOf(issue)));
    return [
      ...mine,
      ...theirs
        .map((issue) => toIssue(issue))
        .filter((issue) => !seen.has(idOf(issue))),
    ];
  };
  return {
    errors: merge(local.errors, remote.errors),
    warnings: merge(local.warnings, remote.warnings),
  };
};
