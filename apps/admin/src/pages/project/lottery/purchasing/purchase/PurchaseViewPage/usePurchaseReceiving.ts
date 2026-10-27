import { useLotteryPurchaseReceivingQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

/** 進貨單的點收進度(`lotteryPurchaseReceiving`;同一個快取 key,檢視頁、申請中心詳情頁共用)。 */
export const usePurchaseReceiving = (submissionId: string) => {
  const { session } = useSession();
  const receiving = useLotteryPurchaseReceivingQuery(
    session.client,
    { submissionId },
    { enabled: submissionId !== "" },
  );
  return receiving.data?.lotteryPurchaseReceiving ?? null;
};
