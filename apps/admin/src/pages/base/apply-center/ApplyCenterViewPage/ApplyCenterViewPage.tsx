import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  useFormSubmissionQuery,
  useWorkflowInstanceQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useTabLabelRenderer } from "@/components/base/form-engine/FormModulePages/useTabLabelRenderer";
import { FormRenderer } from "@/components/base/form-engine/FormRenderer/FormRenderer";
import { ApprovalSection } from "@/components/base/workflow/ApprovalSection/ApprovalSection";
import { SubmissionStatusTag } from "@/components/base/workflow/SubmissionStatusTag";
import { useFormRuntimeVersion } from "@/hooks/base/useFormRuntimeVersion";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { revisionContextOf } from "@/lib/base/form-engine/expression-context";
import { permissionsOfSubmission } from "@/lib/base/form-engine/field-permissions";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import {
  APPLY_CENTER_MODULE_KEY,
  formModulePageKey,
} from "../apply-center-keys";

/**
 * 申請中心詳情頁(隱藏頁 `apply-center.view-page`,Spec 6b §8 畫面 9):網址
 * `/apply-center/view-page/<實例 id>`(與通知信的連結同形狀)。**不經業務模組的頁面權限**:
 * 沒有該模組權限的審核者也從這裡看。
 *
 * 內容 = 該實例**那個修訂**的快照唯讀渲染(條件用那次送出的 `ctx`、不重算存值)+ 審核區塊(分支進度、
 * 我的任務動作、時間軸)。讀取授權在 api(`canReadSubmissionRevision`):任務持有者只讀得到他審的那個修訂。
 */
export const ApplyCenterViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.applyCenter.view");
  const tErrors = useTranslations("admin.workflows.errors");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const routeOf = useModuleRoutes();
  const { session } = useSession();
  const instanceId = routeParam ?? "";
  const instanceQuery = useWorkflowInstanceQuery(
    session.client,
    { id: instanceId },
    { enabled: instanceId !== "", retry: false },
  );
  const instance = instanceQuery.data?.workflowInstance.instance ?? null;
  const submissionQuery = useFormSubmissionQuery(
    session.client,
    { id: instance?.submissionId ?? "", revision: instance?.revision ?? 0 },
    { enabled: instance !== null, retry: false },
  );
  const submission = submissionQuery.data?.formSubmission.submission ?? null;
  const version = useFormRuntimeVersion(
    instance?.formKey ?? null,
    instance?.formVersion ?? null,
  );
  const expressionContext = useMemo(
    () =>
      submission?.ctx === null || submission?.ctx === undefined
        ? null
        : revisionContextOf(submission.ctx),
    [submission],
  );
  const permissions = useMemo(
    () => (submission === null ? null : permissionsOfSubmission(submission)),
    [submission],
  );
  // 頁籤 / 標題:與表單模組詳情頁同一個算法,以那個修訂的值即時算(日期用讀者的租戶時區);
  // 實例、快照與定義都載到前先不給(頁籤維持模組名,不先用表單名算一次再換)
  const tabLabelOf = useTabLabelRenderer({
    moduleKey: instance?.moduleKey ?? "",
    moduleName: instance?.moduleName,
    formKey: instance?.formKey,
    formName: instance?.formName,
    definition: version.definition,
    isLoading:
      instance === null || submissionQuery.isLoading || version.isLoading,
    action: "view",
    applicantName: instance?.applicant?.name,
    submittedAt: submission?.submittedAt,
  });
  const title = tabLabelOf(submission?.values);
  useRouteTabItemLabel(title);

  if (
    instanceQuery.isLoading ||
    submissionQuery.isLoading ||
    version.isLoading
  ) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (instance === null) {
    const code =
      instanceQuery.error === null
        ? "NOT_FOUND"
        : workflowErrorOf(instanceQuery.error).code;
    return <Alert severity="error">{tErrors(code)}</Alert>;
  }

  const listRoute = routeOf(APPLY_CENTER_MODULE_KEY);
  const editRoute = routeOf(formModulePageKey(instance.moduleKey, "edit-page"));
  const isCurrent =
    submission !== null && submission.currentInstanceId === instance.id;

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <Stack spacing={2.25}>
        {listRoute !== null && (
          <Stack direction="row">
            <Button
              variant="text"
              size="small"
              onClick={() => {
                void navigate(tabHref(listRoute));
              }}
            >
              {t("back")}
            </Button>
          </Stack>
        )}
        <Stack spacing={0.5}>
          <Typography variant="h6" component="h1">
            {title}
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="body2" color="text.secondary">
              {t("meta", {
                module: instance.moduleName ?? instance.moduleKey,
                form: instance.formName ?? instance.formKey,
                applicant: instance.applicant?.name ?? "—",
                revision: instance.revision,
              })}
            </Typography>
            {isCurrent && (
              <SubmissionStatusTag
                status={submission.status}
                blocked={submission.blocked}
              />
            )}
          </Stack>
        </Stack>
        {submission === null ||
        version.definition === null ||
        expressionContext === null ||
        permissions === null ? (
          <Alert severity="warning">{t("snapshotUnavailable")}</Alert>
        ) : (
          <FormRenderer
            version={version.definition}
            values={submission.values}
            mode="readonly"
            context={{
              formKey: instance.formKey,
              version: instance.formVersion,
            }}
            expressionContext={expressionContext}
            permissions={permissions}
            displayValues={submission.displayValues}
          />
        )}
        <ApprovalSection
          instanceId={instance.id}
          submission={isCurrent ? submission : null}
          onCopied={(copiedId) => {
            if (editRoute !== null) {
              void navigate(`${editRoute}/${copiedId}`);
            }
          }}
        />
      </Stack>
    </Card>
  );
};
