import { useTranslations } from "use-intl";

import {
  type AssigneeSource,
  type WorkflowDefinition,
  type WorkflowIssue,
  isJoinStep,
} from "@repo/domain/workflow";

import { hasAudienceRows } from "@/lib/base/audience-draft";

import type { JoinNodeData, ReviewNodeData } from "./flow-nodes";
import type { CatalogForm } from "./useDesignerCatalog";

/**
 * 流程圖節點要顯示的文字(React Flow 的 `node.data`):審核關卡卡片的來源 / 會簽 / 跳過條件 / 退回,
 * 匯合節點的名稱;有檢查器錯誤時標出幾個。文案在這裡組好,節點元件只負責畫。
 */
export const useFlowNodeData = (
  definition: WorkflowDefinition,
  errors: readonly WorkflowIssue[],
  forms: readonly CatalogForm[],
): ((stepKey: string) => ReviewNodeData | JoinNodeData) => {
  const t = useTranslations("admin.workflows.node");
  const tMode = useTranslations("admin.workflows.step.modes");
  const tKinds = useTranslations("admin.workflows.assignee.kinds");

  const sourceLine = (source: AssigneeSource): string => {
    switch (source.kind) {
      case "audience": {
        return t("audience", {
          source: hasAudienceRows(source.audience)
            ? tKinds("audience")
            : t("unset"),
        });
      }
      case "field": {
        const form = forms.find((item) => item.key === source.formKey);
        return t("field", {
          form: form?.name ?? (source.formKey || t("unset")),
          field: source.fieldKey || t("unset"),
        });
      }
      case "manager": {
        return t("manager", { level: source.level });
      }
    }
  };

  return (stepKey) => {
    const step = definition.steps.find((item) => item.key === stepKey);
    const issueCount = errors.filter(
      (issue) => issue.location.stepKey === stepKey,
    ).length;
    const issueLabel = t("issues", { count: issueCount });
    if (step === undefined || isJoinStep(step)) {
      return {
        title: t("join", { name: step?.name ?? stepKey }),
        issueCount,
        issueLabel,
      };
    }
    const lines = [sourceLine(step.assignee), tMode(step.mode)];
    if (step.skipWhen !== undefined && step.skipWhen !== null) {
      lines.push(t("skipWhen"));
    }
    if (step.allowReturn === false) {
      lines.push(t("noReturn"));
    }
    return { title: step.name, lines, issueCount, issueLabel };
  };
};
