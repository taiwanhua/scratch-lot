import { useTranslations } from "use-intl";

import type { FormWorkflowOptionsQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

type WorkflowOption =
  FormWorkflowOptionsQuery["formWorkflowOptions"]["items"][number];

/** 以共用流程為基底建客製流程就能綁的原因:審核者條件用了共用流程不能用的使用者 / 角色 / 指定組織。 */
const FORKABLE_PROBLEMS = new Set(["AUDIENCE_IN_SHARED"]);

export interface UnbindableWorkflowsProps {
  items: readonly WorkflowOption[];
  /** 「建客製流程」捷徑;沒有流程管理頁可進時為 null */
  onCreateCustom: ((workflowKey: string) => void) | null;
}

/**
 * 看得到、但**不能直接綁**的流程與原因(哪一關、什麼問題)。共用流程因為審核者條件用了使用者 / 角色 /
 * 指定組織而不能綁的,附「建客製流程」:到流程管理以它為基底建一個自己的,改成本租戶的條件後再回來綁。
 */
export const UnbindableWorkflows = ({
  items,
  onCreateCustom,
}: UnbindableWorkflowsProps) => {
  const t = useTranslations("admin.forms.binding");
  if (items.length === 0) {
    return null;
  }
  return (
    <Stack spacing={1} component="section" aria-label={t("unbindableRegion")}>
      <Typography variant="caption" color="text.secondary">
        {t("unbindableTitle")}
      </Typography>
      {items.map((item) => (
        <Stack key={item.workflowKey} spacing={0.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2">{item.workflowName}</Typography>
            {onCreateCustom !== null &&
              item.isShared &&
              item.issues.some((issue) =>
                FORKABLE_PROBLEMS.has(issue.problem),
              ) && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    onCreateCustom(item.workflowKey);
                  }}
                >
                  {t("createCustom")}
                </Button>
              )}
          </Stack>
          {item.issues.map((issue) => (
            <Typography
              key={`${issue.stepKey}-${issue.problem}`}
              variant="caption"
              color="text.secondary"
            >
              {t("issue", {
                step: issue.stepNumber,
                problem: t(`problems.${issue.problem}`),
              })}
            </Typography>
          ))}
        </Stack>
      ))}
    </Stack>
  );
};
