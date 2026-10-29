import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";

import { useFormEntry } from "@/components/base/form-engine/FormModulePages/useFormEntry";
import { usePermissions } from "@/hooks/base/usePermissions";

import type { PendingRequisition } from "../PurchaseListTab/purchase-list-actions";
import {
  PURCHASE_FORM_KEY,
  PURCHASE_FROM_REQUISITION,
  PURCHASE_MODULE_KEY,
  PURCHASE_PERMISSIONS,
} from "./purchase-keys";

/**
 * 採購清單上每張待購買叫貨單的 [建立進貨單](規格 8.1):開進貨單新增頁並帶入這張叫貨單與它的分店
 * (`?requisition=<單號>&branch=<分店>`)。沒有 `purchasing.purchase.create` 或沒綁新增頁就不顯示。
 */
export const CreatePurchaseAction = ({
  requisition,
}: {
  requisition: PendingRequisition;
}) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase");
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const entry = useFormEntry(PURCHASE_MODULE_KEY, PURCHASE_FORM_KEY);
  const { access } = entry;
  const serialNo = requisition.serialNo ?? null;
  if (
    access.createRoute === null ||
    !hasPermission(PURCHASE_PERMISSIONS.create) ||
    serialNo === null
  ) {
    return null;
  }
  const params = new URLSearchParams({
    [PURCHASE_FROM_REQUISITION.requisition]: serialNo,
    [PURCHASE_FROM_REQUISITION.branch]: requisition.orgId,
  });
  return (
    <Button
      variant="outlined"
      size="small"
      onClick={() => {
        void navigate(entry.createHref(params) ?? "");
      }}
    >
      {t("createFromRequisition")}
    </Button>
  );
};
