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
  WHOLESALE_FORM_KEY,
  WHOLESALE_MODULE_KEY,
  WHOLESALE_PAYMENT_MODE,
} from "../wholesale-keys";
import { WholesaleForm } from "./WholesaleForm";

/**
 * 批售單的替換新增頁(規格 21.3;Figma WS-02):畫面在 `WholesaleForm`(編輯頁同一個畫面)。出貨分店:店長預設自己的分店;
 * 最上層組織(總部)不預設。收款方式預設「收到錢再核准」。存值交給表單引擎(`useFormDraft`),送出前的檢查在 api 的掛接點。
 */
export const WholesaleCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const me = useMe();
  const {
    access,
    form,
    isLoading: isFormsLoading,
  } = useFormEntry(WHOLESALE_MODULE_KEY, WHOLESALE_FORM_KEY);
  const draft = useFormDraft(WHOLESALE_FORM_KEY);
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
  const isHeadquarters =
    currentOrg?.tenantId == null || currentOrg.tenantId === currentOrg.id;

  return (
    <WholesaleForm
      mode="create"
      title={t("title")}
      initial={{
        header: {
          fromBranchId: isHeadquarters ? "" : currentOrg.id,
          customerId: null,
          paymentMode: WHOLESALE_PAYMENT_MODE.collectFirst,
          accountId: null,
          note: "",
        },
        lines: [],
        keptLines: [],
      }}
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
