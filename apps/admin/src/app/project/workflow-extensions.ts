import type { WorkflowExtensionRegistration } from "@/hooks/base/useWorkflowExtensions";
import { TransferShipmentEffect } from "@/pages/project/lottery/purchasing/transfer/TransferShipmentEffect";
import { TRANSFER_MODULE_KEY } from "@/pages/project/lottery/purchasing/transfer/transfer-keys";
import { MakeupPunchReview } from "@/pages/project/schedule/attendance/MakeupPunchReview";
import { MAKEUP_PUNCH_MODULE_KEY } from "@/pages/project/schedule/attendance/attendance-keys";

/**
 * 專案依模組登記的審核擴充(組裝在 `app/module-pages.tsx`;規則見 `docs/modules/workflows.md`
 * 「依模組登記的審核擴充」):`Effect` = 寫入成功之後的動作、`Review` = 審核畫面的警告與停用 [核准]。
 * 同一個模組可以登記多筆,各做各的。
 */
export const projectWorkflowExtensions: readonly WorkflowExtensionRegistration[] =
  [
    // 調貨單:第一關(出貨確認)通過(含跳過)→ 自動印調貨出貨單(規格 8.4、第 12 章)
    { moduleKey: TRANSFER_MODULE_KEY, Effect: TransferShipmentEffect },
    // 補打卡申請:選的排班已被刪除 → 警告、停用 [核准](規格 14.8;api 的 beforeApprove 同樣擋)
    { moduleKey: MAKEUP_PUNCH_MODULE_KEY, Review: MakeupPunchReview },
  ];
