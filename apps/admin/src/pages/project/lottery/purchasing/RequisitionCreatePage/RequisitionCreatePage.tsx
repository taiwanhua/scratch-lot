import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useFormEntry } from "@/components/base/form-engine/FormModulePages/useFormEntry";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";

import {
  REQUISITION_FORM_KEY,
  REQUISITION_MODULE_KEY,
} from "../purchasing-keys";
import { RequisitionForm } from "./RequisitionForm";
import { emptyRequisitionState } from "./requisition-form";

/**
 * 叫貨單的替換新增頁(規格 8.1;Figma PU-02):畫面在 `RequisitionForm`(編輯頁同一個畫面)。
 * 店長預設自己的分店;當前組織是最上層組織(總部)或根組織時不預設,從可見分店選。
 * 存值交給表單引擎(`useFormDraft`),流程與掛接點照常。
 */
export const RequisitionCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const me = useMe();
  const {
    access,
    form,
    isLoading: isFormsLoading,
  } = useFormEntry(REQUISITION_MODULE_KEY, REQUISITION_FORM_KEY);
  const draft = useFormDraft(REQUISITION_FORM_KEY);
  useRouteTabItemLabel(t("tabLabel"));

  const backToList = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  if (isFormsLoading || me.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (form === undefined) {
    return <Alert severity="error">{t("unavailable")}</Alert>;
  }
  const currentOrg = me.data?.me.currentOrg;
  const defaultBranch =
    currentOrg?.tenantId == null || currentOrg.tenantId === currentOrg.id
      ? ""
      : currentOrg.id;

  return (
    <RequisitionForm
      title={t("title")}
      initial={emptyRequisitionState(defaultBranch)}
      canSaveDraft={form.allowDraft}
      isPending={draft.isPending}
      error={draft.error}
      onSaveDraft={(values) => {
        void draft.saveDraft(values, []).then((saved) => {
          if (saved !== null) {
            showSnackbar("success", t("draftSaved"));
          }
        });
      }}
      onSubmit={(values) => {
        void draft.submit(values, []).then((submitted) => {
          if (submitted === null) {
            return;
          }
          showSnackbar("success", t("submitted"));
          if (access.viewRoute === null) {
            backToList();
          } else {
            void navigate(`${access.viewRoute}/${submitted.id}`);
          }
        });
      }}
      onCancel={backToList}
    />
  );
};
