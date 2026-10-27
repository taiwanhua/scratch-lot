import type { ApplyCenterSectionProps } from "@/hooks/base/useWorkflowExtensions";

import { TransferReceivingSection } from "./TransferViewPage/TransferReceivingSection";

/**
 * 調貨單在申請中心詳情頁的專屬區塊(審核擴充 `Section`;規格 8.4 第二關點收):和檢視頁同一個點收區塊
 * (出貨之後才出現)。能不能刷由 api 的 `canReceive` 決定(收貨店店長的點收任務在自己手上)。
 */
export const TransferApplyCenterSection = ({
  submission,
}: ApplyCenterSectionProps) => (
  <TransferReceivingSection submission={submission} />
);
