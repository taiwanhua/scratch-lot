import type { ApplyCenterSectionProps } from "@/hooks/base/useWorkflowExtensions";

import { PurchaseReceiveHint } from "./PurchaseViewPage/PurchaseReceiveHint";
import { PurchaseReceivingSection } from "./PurchaseViewPage/PurchaseReceivingSection";

/**
 * 進貨單在申請中心詳情頁的專屬區塊(審核擴充 `Section`;規格 8.2「店長從申請中心進入,在審核頁逐本刷條碼點收」):
 * 和檢視頁同一個點收提示與點收區塊。能不能刷由 api 的 `canReceive` 決定(點收任務在自己手上)。
 */
export const PurchaseApplyCenterSection = ({
  submission,
}: ApplyCenterSectionProps) => (
  <>
    <PurchaseReceiveHint submissionId={submission.id} />
    <PurchaseReceivingSection submission={submission} />
  </>
);
