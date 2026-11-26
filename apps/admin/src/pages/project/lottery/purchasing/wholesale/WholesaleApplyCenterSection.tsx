import { useLotteryWholesaleDetailQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import type { ApplyCenterSectionProps } from "@/hooks/base/useWorkflowExtensions";

import { WholesaleBooksSection } from "./WholesaleViewPage/WholesaleBooksSection";
import { WholesaleSettlementSection } from "./WholesaleViewPage/WholesaleSettlementSection";

/**
 * 批售單在申請中心詳情頁的專屬區塊(審核擴充 `Section`;規格 21.3、Figma WS-04):和檢視頁同一份本清單與結算區塊,
 * 店長在審核頁就能按 [收款]。收付按鈕由 api 回的結算決定。
 */
export const WholesaleApplyCenterSection = ({
  submission,
}: ApplyCenterSectionProps) => {
  const { session } = useSession();
  const query = useLotteryWholesaleDetailQuery(session.client, {
    submissionId: submission.id,
  });
  const detail = query.data?.lotteryWholesaleDetail ?? null;
  return detail === null ? null : (
    <>
      <WholesaleBooksSection status={submission.status} detail={detail} />
      <WholesaleSettlementSection submission={submission} detail={detail} />
    </>
  );
};
