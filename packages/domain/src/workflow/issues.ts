/**
 * 流程定義檢查器的錯誤 / 警告。**有錯不能發布,警告可發布**;
 * 每筆都定位到關卡(或連線),設計器點擊可跳到該節點。
 */

/** 錯誤碼(有錯不能發布)。 */
export const WORKFLOW_ERROR_CODES = [
  // 基本
  "WORKFLOW_EMPTY",
  "STEP_KEY_DUPLICATE",
  "STEP_KEY_FORMAT",
  "STEP_KIND_UNKNOWN",
  "MODE_INVALID",
  "ASSIGNEE_KIND_UNKNOWN",
  // 審核者來源
  "AUDIENCE_INVALID",
  "AUDIENCE_IN_SHARED",
  "ROLE_NOT_IN_TENANT",
  "ORG_NOT_IN_TENANT",
  "FIELD_FORM_MISSING",
  "FIELD_MISSING",
  "FIELD_NOT_USER_REFERENCE",
  "FIELD_NOT_ORG_REFERENCE",
  "MANAGER_LEVEL_INVALID",
  // 跳過條件
  "CHECK_FORM_UNAVAILABLE",
  "SKIP_UNKNOWN_OPERATOR",
  "SKIP_INVALID",
  "SKIP_UNKNOWN_FIELD",
  "SKIP_PROTECTED_FIELD",
  // 指定組織跳過、自動通過
  "SKIP_ORGS_INVALID",
  "SKIP_ORGS_IN_SHARED",
  "AUTO_APPROVE_INVALID",
  // 逾時提醒(知會對象的來源沿用審核者的碼,`property` 指到 `cc…`)
  "OVERDUE_INVALID",
  // 匯合節點
  "JOIN_IN_LINEAR",
  "JOIN_HAS_REVIEW_PROPS",
  "JOIN_TOO_FEW_INCOMING",
  "JOIN_OUTGOING_INVALID",
  // 結構(有 edges 時)
  "EDGE_UNKNOWN_STEP",
  "EDGE_DUPLICATE",
  "START_NOT_UNIQUE",
  "END_NOT_UNIQUE",
  "UNREACHABLE",
  "CYCLE",
  "REVIEW_MULTIPLE_INCOMING",
  "FORK_JOIN_MISMATCH",
  "BRANCH_EMPTY",
  "NESTED_FORK",
  "CROSS_BRANCH",
] as const;

/** 警告碼(可發布)。 */
export const WORKFLOW_WARNING_CODES = [
  "USER_INVALID",
  "ALL_STEPS_SKIPPABLE",
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export type WorkflowWarningCode = (typeof WORKFLOW_WARNING_CODES)[number];

export type WorkflowIssueCode = WorkflowErrorCode | WorkflowWarningCode;

export interface WorkflowIssueLocation {
  stepKey?: string;
  /** `steps[]` 的索引。 */
  stepIndex?: number;
  /** `edges[]` 的索引。 */
  edgeIndex?: number;
  /** 關卡上的哪個屬性出錯(`assignee.audience.filter.children[0].value`、`skipWhen`…)。 */
  property?: string;
  /** 跳過條件表達式樹裡的節點位置(根為空字串)。 */
  exprPath?: string;
}

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** 給設計者看的繁中說明。 */
  message: string;
  location: WorkflowIssueLocation;
}

export interface WorkflowValidationReport {
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
}

/** 檢查器各段共用的收集器。 */
export class WorkflowIssueCollector {
  readonly errors: WorkflowIssue[] = [];
  readonly warnings: WorkflowIssue[] = [];

  error(
    code: WorkflowErrorCode,
    message: string,
    location: WorkflowIssueLocation,
  ): void {
    this.errors.push({ code, message, location });
  }

  warn(
    code: WorkflowWarningCode,
    message: string,
    location: WorkflowIssueLocation,
  ): void {
    this.warnings.push({ code, message, location });
  }
}
