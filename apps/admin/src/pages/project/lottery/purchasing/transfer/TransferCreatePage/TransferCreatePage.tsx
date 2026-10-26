import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import type { BookRowStatus } from "@/components/project/lottery/BookGroupList/BookGroupList";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useUrlState } from "@/hooks/base/useUrlState";

import {
  TRANSFER_FORM_KEY,
  TRANSFER_FROM_REQUISITION,
  TRANSFER_MODULE_KEY,
} from "../transfer-keys";
import { TransferForm } from "./TransferForm";

/** 帶入的值(空字串 = 沒帶)。 */
const fromSchema = z.string().default("");

const NO_LOCKED: ReadonlyMap<string, BookRowStatus> = new Map();

/**
 * 調貨單的替換新增頁(專案規格 8.4「頁面」;Figma PU-09):畫面在 `TransferForm`(編輯頁同一個畫面)。
 * 出貨分店:店長預設自己的分店;最上層組織(總部)不預設。從採購清單 [從其他分店調貨] 進來時帶
 * `?requisition=<單號>&to=<收貨分店>`。存值交給表單引擎(`useFormDraft`),送出前的檢查在 api 的掛接點。
 */
export const TransferCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const me = useMe();
  const access = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const { creatableForms, isLoading: isFormsLoading } =
    useModuleForms(TRANSFER_MODULE_KEY);
  const form = creatableForms.find((item) => item.key === TRANSFER_FORM_KEY);
  const draft = useFormDraft(TRANSFER_FORM_KEY);
  useRouteTabItemLabel(t("tabLabel"));

  const [fromRequisition] = useUrlState(
    TRANSFER_FROM_REQUISITION.requisition,
    fromSchema,
  );
  const [fromTo] = useUrlState(TRANSFER_FROM_REQUISITION.to, fromSchema);
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
    <TransferForm
      mode="create"
      submissionId={null}
      title={t("title")}
      initial={{
        header: {
          fromBranchId: isHeadquarters ? "" : currentOrg.id,
          toBranchId: fromTo,
          requisitionNo: fromRequisition === "" ? null : fromRequisition,
          note: "",
        },
        lines: [],
      }}
      lockedRows={NO_LOCKED}
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
