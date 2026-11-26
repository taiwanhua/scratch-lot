import { useTranslations } from "use-intl";

import { wholesaleHeaderOf } from "@repo/domain/project/lottery";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  type LotteryWholesaleDetailQuery,
  useLotterySettlementQuery,
} from "@repo/graphql";

import { ReceiptPrintButton } from "@/components/project/lottery/ReceiptPrint/ReceiptPrintButton";
import { useReceiptLinks } from "@/components/project/lottery/ReceiptPrint/useReceiptLinks";
import { useSession } from "@/hooks/base/useSession";
import { latestWholesalePaymentInputOf } from "@/lib/project/lottery/receipts/wholesale-payment-receipt";
import { wholesaleShipmentInputOf } from "@/lib/project/lottery/receipts/wholesale-shipment-receipt";

import { WHOLESALE_MODULE_KEY } from "../wholesale-keys";

type WholesaleDetail = LotteryWholesaleDetailQuery["lotteryWholesaleDetail"];

export interface WholesalePrintButtonsProps {
  submission: FormSubmissionFieldsFragment;
  detail: WholesaleDetail;
}

/**
 * 批售單標頭的 [列印] / [補印](規格 21.8;Figma RC-11、RC-12):每種單據各一顆,前面寫單據名稱 ——
 * - 批售出貨單:已出貨(有出貨時間)才有;核准完成後的自動列印是審核擴充(`WholesaleShipmentEffect`)
 * - 批售收款收據:最近一筆出貨店收的現金(同調貨付款收據);[收款] 選現金後的自動列印在結算區塊(`useSettlementReceipt`)
 *
 * 沒有 `api.printing.print` 時都不出現(底座列印按鈕);草稿不印。QR 連到批售單檢視頁(路由依模組樹,`lotteryReceiptLinks`)。
 * 收付與結算區塊用同一個查詢(同一份快取)。
 */
export const WholesalePrintButtons = ({
  submission,
  detail,
}: WholesalePrintButtonsProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.view");
  const { session } = useSession();
  const { links } = useReceiptLinks();
  const isDraft = submission.status === FormSubmissionStatus.Draft;
  const settlement = useLotterySettlementQuery(
    session.client,
    { moduleKey: WHOLESALE_MODULE_KEY, refId: submission.id },
    { enabled: !isDraft, retry: false },
  );
  if (isDraft) {
    return null;
  }
  const url = links.wholesaleViewUrl(submission.id);
  const shipment =
    detail.shippedAt == null
      ? null
      : wholesaleShipmentInputOf(detail, {
          submissionId: submission.id,
          serialNo: submission.serialNo ?? null,
          fromBranchId: wholesaleHeaderOf(submission.values).fromBranchId ?? "",
          url,
        });
  const item = settlement.data?.lotterySettlement.item ?? null;
  const payment =
    item === null ? null : latestWholesalePaymentInputOf(item, url);
  return (
    <>
      {shipment !== null && (
        <ReceiptPrintButton
          kind="wholesale-shipment"
          payload={shipment}
          label={t("printShipment")}
        />
      )}
      {payment !== null && (
        <ReceiptPrintButton
          kind="wholesale-payment"
          payload={payment}
          label={t("printPayment")}
        />
      )}
    </>
  );
};
