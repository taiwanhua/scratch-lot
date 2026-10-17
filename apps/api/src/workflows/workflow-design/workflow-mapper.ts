import type {
  WorkflowValidationReport as DomainReport,
  WorkflowIssue,
} from "@repo/domain/workflow";

import type { Persisted } from "../../database/base.repository";
import type { WorkflowVersionDocument } from "../../database/database.module";
import { userRefOf } from "../../forms/form-mapper";
import {
  type WorkflowIssueModel,
  type WorkflowValidationReport,
  type WorkflowVersionModel,
  WorkflowVersionStatusEnum,
} from "./models/workflow.model";

export type WorkflowVersionRecord = Persisted<WorkflowVersionDocument>;

const STATUS_BY_VALUE: Readonly<Record<string, WorkflowVersionStatusEnum>> = {
  draft: WorkflowVersionStatusEnum.DRAFT,
  publishing: WorkflowVersionStatusEnum.PUBLISHING,
  published: WorkflowVersionStatusEnum.PUBLISHED,
  retired: WorkflowVersionStatusEnum.RETIRED,
};

/** 落庫的版本 → 對外形狀(`steps` / `edges` 原樣,節點 `kind` 與連線全程保留)。 */
export function toWorkflowVersionModel(
  record: WorkflowVersionRecord,
  names: ReadonlyMap<string, string>,
): WorkflowVersionModel {
  const edges = record.edges ?? [];
  return {
    id: String(record._id),
    workflowKey: record.workflowKey,
    version: record.version,
    status: STATUS_BY_VALUE[record.status] ?? WorkflowVersionStatusEnum.DRAFT,
    draftRevision: record.draftRevision,
    baseVersion: record.baseVersion,
    steps: record.steps.map((step) => ({ ...step })),
    edges:
      edges.length > 0
        ? edges.map((edge) => ({ from: edge.from, to: edge.to }))
        : null,
    checkFormKey: record.checkFormKey ?? null,
    cc: record.cc ? { ...record.cc } : null,
    changelog: record.changelog,
    publishedAt: record.publishedAt,
    publishedBy: userRefOf(record.publishedBy, names),
  };
}

function toIssueModel(issue: WorkflowIssue): WorkflowIssueModel {
  return {
    code: issue.code,
    message: issue.message,
    stepKey: issue.location.stepKey ?? null,
    stepIndex: issue.location.stepIndex ?? null,
    edgeIndex: issue.location.edgeIndex ?? null,
    property: issue.location.property ?? null,
    exprPath: issue.location.exprPath ?? null,
  };
}

export function toWorkflowValidationReport(
  report: DomainReport,
): WorkflowValidationReport {
  return {
    errors: report.errors.map((issue) => toIssueModel(issue)),
    warnings: report.warnings.map((issue) => toIssueModel(issue)),
  };
}
