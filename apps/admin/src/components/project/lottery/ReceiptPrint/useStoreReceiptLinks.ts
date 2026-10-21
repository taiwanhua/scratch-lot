import { useCallback } from "react";

import { STORE_KEY } from "@repo/domain/project/lottery";
import {
  ACCOUNTS_MODULE_KEYS,
  ACCOUNTS_TABS,
} from "@repo/domain/project/lottery-accounts";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";

/**
 * 店面單據底部 QR code 的連結(規格第 12 章):
 * 現金流水類(投庫、出庫、存款)沒有詳情頁 → 即時現金帳 `?movementId=<流水 id>`(打開時標亮那一筆,10.2);
 * 申請類(結帳確認申請、撤銷售出申請)→ 店面管理的檢視頁。
 */
export const useStoreReceiptLinks = () => {
  const routeOf = useModuleRoutes();
  const { viewRoute } = useFormModuleAccess(STORE_KEY);
  const accountsRoute = routeOf(ACCOUNTS_MODULE_KEYS.list);
  const origin = globalThis.location.origin;
  const cashLedgerUrl = useCallback(
    (movementId: string) =>
      `${origin}${accountsRoute ?? ""}?tab=${ACCOUNTS_TABS.cash}&movementId=${movementId}`,
    [accountsRoute, origin],
  );
  const storeViewUrl = useCallback(
    (submissionId: string) => `${origin}${viewRoute ?? ""}/${submissionId}`,
    [origin, viewRoute],
  );
  return { cashLedgerUrl, storeViewUrl };
};
