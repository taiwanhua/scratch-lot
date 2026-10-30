import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { Alert } from "@repo/ui/alert";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useFormEntry } from "@/components/base/form-engine/FormModulePages/useFormEntry";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import {
  PURCHASE_FORM_KEY,
  PURCHASE_FROM_REQUISITION,
  PURCHASE_MODULE_KEY,
} from "../purchase-keys";
import { PurchaseForm } from "./PurchaseForm";
import type { PurchaseFormState } from "./purchase-form";

/** 帶入的值(空字串 = 沒帶)。 */
const fromSchema = z.string().default("");

const NO_LOCKED: ReadonlySet<string> = new Set();

/**
 * 進貨單的替換新增頁(專案規格 8.2;Figma PU-05):畫面在 `PurchaseForm`(編輯頁同一個畫面)。
 * 進貨分店:帶入的分店優先;店長預設自己的分店;最上層組織(總部)不預設。批購日期預設今天(租戶時區)。
 * 從採購清單 [建立進貨單] 進來時帶 `?requisition=<單號>&branch=<分店>`。存值交給表單引擎(`useFormDraft`),
 * 送出前的檢查在 api 的掛接點。
 */
export const PurchaseCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.create");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const me = useMe();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const {
    access,
    form,
    isLoading: isFormsLoading,
  } = useFormEntry(PURCHASE_MODULE_KEY, PURCHASE_FORM_KEY);
  const draft = useFormDraft(PURCHASE_FORM_KEY);
  useRouteTabItemLabel(t("tabLabel"));

  // 從採購清單 [建立進貨單] 帶入的叫貨單單號與分店(網址;只在打開時讀)
  const [fromRequisition] = useUrlState(
    PURCHASE_FROM_REQUISITION.requisition,
    fromSchema,
  );
  const [fromBranch] = useUrlState(
    PURCHASE_FROM_REQUISITION.branch,
    fromSchema,
  );
  const [today] = useState(() => localDayTextOf(new Date(), timezone));
  const currentOrg = me.data?.me.currentOrg;
  const isHeadquarters =
    currentOrg?.tenantId == null || currentOrg.tenantId === currentOrg.id;
  const ownBranch = isHeadquarters ? "" : currentOrg.id;

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

  const initial: PurchaseFormState = {
    header: {
      branchId: fromBranch === "" ? ownBranch : fromBranch,
      requisitionNo: fromRequisition === "" ? null : fromRequisition,
      dealerId: null,
      selfPurchase: true,
      trusteeId: null,
      purchaseDate: localDayInstantOf(today, timezone),
      accountId: null,
      note: "",
    },
    books: [],
    redemptions: [],
    keptLines: [],
  };

  return (
    <PurchaseForm
      mode="create"
      submissionId={null}
      title={t("title")}
      initial={initial}
      lockedRowIds={NO_LOCKED}
      extraGames={[]}
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
