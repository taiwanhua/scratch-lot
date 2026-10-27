import { STORE_KEY } from "@repo/domain/project/lottery";

import type { WorkflowExtensionRegistration } from "@/hooks/base/useWorkflowExtensions";
import { PurchaseApplyCenterSection } from "@/pages/project/lottery/purchasing/purchase/PurchaseApplyCenterSection";
import { PURCHASE_MODULE_KEY } from "@/pages/project/lottery/purchasing/purchase/purchase-keys";
import { TransferApplyCenterSection } from "@/pages/project/lottery/purchasing/transfer/TransferApplyCenterSection";
import { TransferShipmentEffect } from "@/pages/project/lottery/purchasing/transfer/TransferShipmentEffect";
import { TRANSFER_MODULE_KEY } from "@/pages/project/lottery/purchasing/transfer/transfer-keys";
import { CheckoutReceiptEffect } from "@/pages/project/lottery/store/checkout/CheckoutReceiptEffect";
import { MakeupPunchReview } from "@/pages/project/schedule/attendance/MakeupPunchReview";
import { MAKEUP_PUNCH_MODULE_KEY } from "@/pages/project/schedule/attendance/attendance-keys";

/**
 * 專案依模組登記的審核擴充(組裝在 `app/module-pages.tsx`;規則見 `docs/modules/workflows.md`
 * 「依模組登記的審核擴充」):`Effect` = 寫入成功之後的動作、`Review` = 審核畫面的警告與停用 [核准]、
 * `Section` = 申請中心詳情頁的表單專屬區塊。
 * 同一個模組可以登記多筆,各做各的。
 */
export const projectWorkflowExtensions: readonly WorkflowExtensionRegistration[] =
  [
    // 調貨單:第一關(出貨確認)通過(含跳過)→ 自動印調貨出貨單(規格 8.4、第 12 章)
    { moduleKey: TRANSFER_MODULE_KEY, Effect: TransferShipmentEffect },
    // 進貨單、調貨單:店長從申請中心(通知連結)進來,在審核頁點收(規格 8.2、8.4;和檢視頁同一個點收區塊)
    { moduleKey: PURCHASE_MODULE_KEY, Section: PurchaseApplyCenterSection },
    { moduleKey: TRANSFER_MODULE_KEY, Section: TransferApplyCenterSection },
    // 結帳確認申請送出 → 自動印交班結帳單 / 日結單(規格第 12 章)
    { moduleKey: STORE_KEY, Effect: CheckoutReceiptEffect },
    // 補打卡申請:選的排班已被刪除 → 警告、停用 [核准](規格 14.8;api 的 beforeApprove 同樣擋)
    { moduleKey: MAKEUP_PUNCH_MODULE_KEY, Review: MakeupPunchReview },
  ];
