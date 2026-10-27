import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";

import { usePurchaseReceiving } from "./usePurchaseReceiving";

/** 點收任務在手上、還有本沒點收時的提示(核准前要全部點收;檢視頁、申請中心詳情頁共用)。 */
export const PurchaseReceiveHint = ({
  submissionId,
}: {
  submissionId: string;
}) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.view");
  const data = usePurchaseReceiving(submissionId);
  const remaining =
    data === null ? 0 : Math.max(0, data.totalCount - data.receivedCount);
  return data?.canReceive === true && remaining > 0 ? (
    <Alert severity="info">{t("receiveHint", { remaining })}</Alert>
  ) : null;
};
