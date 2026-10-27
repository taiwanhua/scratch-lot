import { useTranslations } from "use-intl";

import {
  TRANSFER_SETTLEMENT_SIDE,
  transferSettlementProblemOf,
} from "@repo/domain/project/lottery";
import {
  type FormSubmissionFieldsFragment,
  FormSubmissionStatus,
  type LotterySettlementFieldsFragment,
  useLotterySettlementQuery,
  useLotteryTransferReceivingQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { SettlementPanel } from "@/components/project/lottery/SettlementPanel/SettlementPanel";
import { useSession } from "@/hooks/base/useSession";

import { TRANSFER_MODULE_KEY, formatMoney } from "../transfer-keys";

/** 核准前三個數字不相等時,提示哪一邊還沒記(規格 8.4「核准前」;api 也擋)。 */
const settlementProblemOf = (settlement: LotterySettlementFieldsFragment) => {
  const totalsOf = (side: string) => {
    const found = settlement.sides.find((item) => item.side === side);
    return { out: found?.totalOut ?? 0, in: found?.totalIn ?? 0 };
  };
  return transferSettlementProblemOf(
    settlement.payable,
    totalsOf(TRANSFER_SETTLEMENT_SIDE.receiver),
    totalsOf(TRANSFER_SETTLEMENT_SIDE.shipper),
  );
};

export interface TransferSettlementSectionProps {
  submission: FormSubmissionFieldsFragment;
}

/**
 * 調貨單的結算區塊(專案規格 8.4;檢視頁與申請中心詳情頁共用):兩邊店的收付(`SettlementPanel`,讀得到收付才顯示;
 * 草稿、駁回、作廢的單 api 回錯 → 不顯示)+ 全部點收後三個數字不相等的提示。付款 / 收款寫入後 `SettlementPanel`
 * 重查同一個結算快取,提示跟著變。
 */
export const TransferSettlementSection = ({
  submission,
}: TransferSettlementSectionProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.view");
  const { session } = useSession();
  const id = submission.id;
  const isSubmitted = submission.status !== FormSubmissionStatus.Draft;
  const isReviewing = submission.status === FormSubmissionStatus.Reviewing;
  const settlement = useLotterySettlementQuery(
    session.client,
    { moduleKey: TRANSFER_MODULE_KEY, refId: id },
    { enabled: isSubmitted, retry: false },
  );
  const receiving = useLotteryTransferReceivingQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "" },
  );
  const data = receiving.data?.lotteryTransferReceiving ?? null;
  const settlementItem = settlement.data?.lotterySettlement.item ?? null;
  const allReceived =
    data !== null &&
    data.totalCount > 0 &&
    data.receivedCount === data.totalCount;
  const problem =
    isReviewing && allReceived && settlementItem !== null
      ? settlementProblemOf(settlementItem)
      : null;

  return (
    <>
      {settlementItem !== null && (
        <SettlementPanel moduleKey={TRANSFER_MODULE_KEY} refId={id} />
      )}
      {problem !== null && (
        <Alert severity="warning">
          {t(`problems.${problem.kind}`, {
            amount: formatMoney(problem.amount),
          })}
        </Alert>
      )}
    </>
  );
};
