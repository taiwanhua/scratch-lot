import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { FormSubmissionStatus, useFormSubmissionQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useFormRuntimeVersion } from "@/hooks/base/useFormRuntimeVersion";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useIsCurrentFormVersion } from "@/hooks/base/useIsCurrentFormVersion";
import { useLiveIdentity } from "@/hooks/base/useLiveIdentity";
import { useMe } from "@/hooks/base/useMe";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { liveContextOf } from "@/lib/base/form-engine/expression-context";
import { permissionsOfSubmission } from "@/lib/base/form-engine/field-permissions";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { FormFillForm } from "./FormFillForm";
import { formModuleKeyOf, useFormModuleAccess } from "./useFormModuleAccess";
import { useTabLabelRenderer } from "./useTabLabelRenderer";

/**
 * 表單模組編輯頁(預設組裝)。網址 `/<模組>/edit-page/<id>`:
 * - 草稿:存草稿 / 送出(建立者本人)
 * - 已完成(沒走過流程):儲存修改(需 `edit` + `abilities.canEdit`),每改一次修訂 +1 並存完整快照
 * - 被退回 / 已撤回(申請人本人):同草稿,改完再送出 = 修訂 +1、重新審核
 *
 * 寫入帶 `expectedEditVersion`(已完成另帶 `expectedRevision`);不符 → 提示「已被別人更新,請重新載入」,
 * 按「重新載入」重取這一筆、以新的值重新掛表單(REACT-08:表單以 `editVersion` 為 key)。
 */
export const FormEditPage = ({ module, routeParam }: ModulePageProps) => {
  const moduleKey = formModuleKeyOf(module.key);
  const t = useTranslations("admin.formEngine.fill");
  const tErrors = useTranslations("admin.formEngine.errors");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const showSnackbar = useSnackbar();
  const access = useFormModuleAccess(moduleKey);
  const id = routeParam ?? "";
  const state = useFormSubmission(id);
  const { submission } = state;
  const version = useFormRuntimeVersion(
    submission?.formKey ?? null,
    submission?.version ?? null,
  );
  const [now] = useState(() => new Date());
  const user = me.data?.me;
  const identity = useLiveIdentity();
  // 權限與 ctx 以 useMemo 保持身分穩定:`FormRenderer` 以它們為 memo 依賴
  const timezone = useTenantTimezone();
  const expressionContext = useMemo(
    () => liveContextOf(identity, now, timezone),
    [identity, now, timezone],
  );
  const permissions = useMemo(
    () => (submission === null ? null : permissionsOfSubmission(submission)),
    [submission],
  );
  // 綁舊版本的單不清新版本分區的收合紀錄
  const isCurrentVersion = useIsCurrentFormVersion(
    moduleKey,
    submission?.formKey ?? "",
    submission?.version ?? null,
  );
  // 頁籤 / 標題:以正在輸入的值即時算(`FormFillForm` 呼叫);日期用租戶時區。
  // 頁層不要再呼叫 `useRouteTabItemLabel`:會蓋掉 `FormFillForm` 設的即時值
  const tabLabelOf = useTabLabelRenderer({
    moduleKey,
    formKey: submission?.formKey,
    formName: submission?.formName,
    definition: version.definition,
    isLoading: version.isLoading,
    action: "edit",
    applicantName: submission?.createdBy?.name,
    submittedAt: submission?.submittedAt,
  });

  const tabHref = useRouteTabHref();
  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  if (state.isLoading || version.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (submission === null || version.definition === null) {
    return (
      <Alert severity="error">
        {tErrors(state.loadError?.code ?? "NOT_FOUND")}
      </Alert>
    );
  }
  if (!submission.abilities.canEdit) {
    return <Alert severity="error">{tErrors("FORBIDDEN")}</Alert>;
  }

  const isCompleted = submission.status === FormSubmissionStatus.Completed;
  // 預設值只在「還沒送出過的草稿」跟著依賴重算;送出過(退回 / 撤回 / 已完成)不再動使用者的值
  const isFreshDraft =
    submission.status === FormSubmissionStatus.Draft &&
    submission.revision === 0;

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <FormFillForm
        key={submission.editVersion}
        title={t("editTitle", {
          form: submission.formName ?? submission.formKey,
        })}
        notice={
          (submission.status === FormSubmissionStatus.Returned ||
            submission.status === FormSubmissionStatus.Withdrawn) && (
            <Alert severity="info">
              {t(
                submission.status === FormSubmissionStatus.Returned
                  ? "returnedHint"
                  : "withdrawnHint",
              )}
            </Alert>
          )
        }
        definition={version.definition}
        formKey={submission.formKey}
        version={submission.version}
        isCurrentVersion={isCurrentVersion}
        initialValues={submission.values}
        initialTouched={submission.touched}
        recomputeDefaults={isFreshDraft}
        fillDefaultsOnMount={false}
        systemLabels={{
          user: user?.name ?? null,
          org: user?.currentOrg?.name ?? null,
        }}
        mode="edit"
        permissions={permissions ?? permissionsOfSubmission(submission)}
        expressionContext={expressionContext}
        isCompleted={isCompleted}
        canSaveDraft={submission.abilities.canSaveDraft}
        isPending={state.isPending}
        error={state.error}
        onSaveDraft={(values, touched) => {
          void state.save(values, touched).then((saved) => {
            if (saved !== null) {
              showSnackbar(
                "success",
                isCompleted ? t("changesSaved") : t("draftSaved"),
              );
            }
          });
        }}
        onSubmit={(values, touched) => {
          void state.submit(values, touched).then((submitted) => {
            if (submitted === null) {
              return;
            }
            showSnackbar("success", t("submitted"));
            if (access.viewRoute === null) {
              leave();
            } else {
              void navigate(`${access.viewRoute}/${submitted.id}`);
            }
          });
        }}
        onCancel={leave}
        onReload={() => {
          void queryClient.invalidateQueries({
            queryKey: useFormSubmissionQuery.getKey({ id }),
          });
        }}
        tabLabelOf={tabLabelOf}
      />
    </Card>
  );
};
