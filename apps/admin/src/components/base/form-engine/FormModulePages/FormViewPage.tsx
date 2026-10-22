import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useFormRuntimeVersion } from "@/hooks/base/useFormRuntimeVersion";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useUrlState } from "@/hooks/base/useUrlState";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { ApprovalSection } from "../../workflow/ApprovalSection/ApprovalSection";
import { FormSubmissionDetail } from "../FormSubmissionDetail/FormSubmissionDetail";
import { DeleteSubmissionDialog } from "./DeleteSubmissionDialog";
import { formModuleKeyOf, useFormModuleAccess } from "./useFormModuleAccess";
import { useTabLabelRenderer } from "./useTabLabelRenderer";

/** 開著的唯讀彈窗(`?dialog=`):修訂紀錄;`none` = 沒開(網址不寫)。 */
const dialogSchema = z.enum(["none", "revisions"]).default("none");

/**
 * 表單模組詳情頁(預設組裝)。網址 `/<模組>/view-page/<id>`。
 * 頁籤 / 標題 = 模組層模板(表單的 `tabLabelTemplate` 可覆寫)以這一筆的值即時算(`useTabLabelRenderer`);
 * 編輯 / 刪除依 api 的 `abilities`(已含權限)與「有沒有綁編輯頁」相乘;「修訂紀錄」在刪除左邊,
 * 點開跳窗看表單 / 版本 / 狀態 / 建立者與修訂清單(頁面主體只留標題列與表單內容)。
 * 走過流程的單(`currentInstanceId` 有值)在詳情下方掛審核區塊(客製頁自己放)。
 */
export const FormViewPage = ({ module, routeParam }: ModulePageProps) => {
  const moduleKey = formModuleKeyOf(module.key);
  const t = useTranslations("admin.formEngine.pages");
  const navigate = useNavigate();
  const access = useFormModuleAccess(moduleKey);
  const id = routeParam ?? "";
  const state = useFormSubmission(id);
  const { submission } = state;
  const [isDeleting, setIsDeleting] = useState(false);
  // 修訂紀錄是唯讀的檢視彈窗:開著的狀態記在網址 `?dialog=revisions`(REACT-14)
  const [dialog, setDialog] = useUrlState("dialog", dialogSchema);
  const isHistoryOpen = dialog === "revisions";
  const setIsHistoryOpen = (open: boolean) => {
    setDialog(open ? "revisions" : "none");
  };
  // 頁籤 / 標題:以那一筆的值與綁的版本即時算;日期用讀者的租戶時區;定義載到前先不給(頁籤維持模組名)
  const version = useFormRuntimeVersion(
    submission?.formKey ?? null,
    submission?.version ?? null,
  );
  const tabLabelOf = useTabLabelRenderer({
    moduleKey,
    formKey: submission?.formKey,
    formName: submission?.formName,
    definition: version.definition,
    isLoading: submission === null || version.isLoading,
    action: "view",
    applicantName: submission?.createdBy?.name,
    submittedAt: submission?.submittedAt,
  });
  const title = submission === null ? null : tabLabelOf(submission.values);
  useRouteTabItemLabel(title);
  const closeItemTabs = useCloseItemTabs();

  const tabHref = useRouteTabHref();
  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <Stack spacing={2.25}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Button variant="text" size="small" onClick={leave}>
            {t("backToList")}
          </Button>
          <Box sx={{ flex: 1 }} />
          {submission !== null && (
            <Button
              variant="text"
              onClick={() => {
                setIsHistoryOpen(true);
              }}
            >
              {t("revisions")}
            </Button>
          )}
          {submission?.abilities.canDelete === true && (
            <Button
              variant="text"
              color="error"
              onClick={() => {
                setIsDeleting(true);
              }}
            >
              {t("delete")}
            </Button>
          )}
          {access.editRoute !== null &&
            submission?.abilities.canEdit === true && (
              <Button
                onClick={() => {
                  void navigate(`${access.editRoute ?? ""}/${id}`);
                }}
              >
                {t("edit")}
              </Button>
            )}
        </Stack>
        {title !== null && (
          <Typography variant="h6" component="h1">
            {title}
          </Typography>
        )}
        {(submission?.serialNo ?? null) !== null && (
          <Typography variant="body2" color="textSecondary">
            {t("serialNo", { serialNo: submission?.serialNo ?? "" })}
          </Typography>
        )}
        <FormSubmissionDetail
          id={id}
          isHistoryOpen={isHistoryOpen}
          onHistoryClose={() => {
            setIsHistoryOpen(false);
          }}
        />
        {submission?.currentInstanceId !== null &&
          submission?.currentInstanceId !== undefined && (
            <ApprovalSection
              instanceId={submission.currentInstanceId}
              submission={submission}
              onCopied={(copiedId) => {
                if (access.editRoute !== null) {
                  void navigate(`${access.editRoute}/${copiedId}`);
                }
              }}
            />
          )}
      </Stack>
      {isDeleting && submission !== null && (
        <DeleteSubmissionDialog
          label={
            tabLabelOf(submission.values, { withAction: false }) ??
            submission.formKey
          }
          isSubmitting={state.isPending}
          error={state.error}
          onCancel={() => {
            setIsDeleting(false);
          }}
          onConfirm={() => {
            void state.remove().then((isDeleted) => {
              if (isDeleted) {
                // 關掉這一筆的詳情 / 編輯子頁籤;當前頁籤就是詳情 → 導向列表
                closeItemTabs({
                  pageRoutes: [access.viewRoute, access.editRoute],
                  id,
                  listRoute: access.listRoute,
                });
              }
            });
          }}
        />
      )}
    </Card>
  );
};
