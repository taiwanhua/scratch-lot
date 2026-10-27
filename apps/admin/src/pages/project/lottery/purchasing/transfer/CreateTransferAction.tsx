import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";

import type { PendingRequisition } from "../PurchaseListTab/purchase-list-actions";
import {
  TRANSFER_FORM_KEY,
  TRANSFER_FROM_REQUISITION,
  TRANSFER_MODULE_KEY,
  TRANSFER_PERMISSIONS,
} from "./transfer-keys";

/**
 * 採購清單上每張待購買叫貨單的 [從其他分店調貨](規格 8.1):開調貨單新增頁並帶入這張叫貨單與它的分店
 * (收貨分店;`?requisition=<單號>&to=<分店>`)。沒有 `purchasing.transfer.create` 或沒綁新增頁就不顯示。
 */
export const CreateTransferAction = ({
  requisition,
}: {
  requisition: PendingRequisition;
}) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer");
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const serialNo = requisition.serialNo ?? null;
  if (
    access.createRoute === null ||
    !hasPermission(TRANSFER_PERMISSIONS.create) ||
    serialNo === null
  ) {
    return null;
  }
  const params = new URLSearchParams({
    [TRANSFER_FROM_REQUISITION.requisition]: serialNo,
    [TRANSFER_FROM_REQUISITION.to]: requisition.orgId,
  });
  return (
    <Button
      variant="outlined"
      size="small"
      onClick={() => {
        void navigate(
          `${access.createRoute ?? ""}/${TRANSFER_FORM_KEY}?${params.toString()}`,
        );
      }}
    >
      {t("createFromRequisition")}
    </Button>
  );
};
