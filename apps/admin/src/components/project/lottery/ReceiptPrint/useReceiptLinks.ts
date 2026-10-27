import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { ACCOUNTS_TABS } from "@repo/domain/project/lottery-accounts";
import {
  type LotteryReceiptLinksQuery,
  useLotteryReceiptLinksQuery,
} from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { PRINT_BUTTON_PERMISSIONS } from "@/lib/base/print-button";

/** 單據底部 QR code 的連結(完整網址)。 */
export interface ReceiptLinks {
  /** 現金流水類(投庫、出庫、存款、調貨付款)沒有詳情頁 → 即時現金帳 `?movementId=`(打開時標亮那一筆,10.2) */
  cashLedgerUrl: (movementId: string) => string;
  /** 店面管理的申請(結帳確認申請、撤銷售出申請)→ 檢視頁 */
  storeViewUrl: (submissionId: string) => string;
  /** 進貨單 → 檢視頁 */
  purchaseViewUrl: (submissionId: string) => string;
  /** 調貨單 → 檢視頁 */
  transferViewUrl: (submissionId: string) => string;
}

const linksOf = (
  routes: LotteryReceiptLinksQuery["lotteryReceiptLinks"],
): ReceiptLinks => {
  const origin = globalThis.location.origin;
  return {
    cashLedgerUrl: (movementId) =>
      `${origin}${routes.cashLedger ?? ""}?tab=${ACCOUNTS_TABS.cash}&movementId=${movementId}`,
    storeViewUrl: (submissionId) =>
      `${origin}${routes.storeView ?? ""}/${submissionId}`,
    purchaseViewUrl: (submissionId) =>
      `${origin}${routes.purchaseView ?? ""}/${submissionId}`,
    transferViewUrl: (submissionId) =>
      `${origin}${routes.transferView ?? ""}/${submissionId}`,
  };
};

const NO_ROUTES: LotteryReceiptLinksQuery["lotteryReceiptLinks"] = {
  cashLedger: null,
  storeView: null,
  purchaseView: null,
  transferView: null,
};

/**
 * 58mm 單據 QR code 的連結(規格第 12 章)。頁面路由由 api 依**模組樹**組(`lotteryReceiptLinks`),
 * **不依印單的人的權限** —— 不能用 `me.modules`(已依權限過濾):店員印的投庫單沒有帳戶管理,
 * 掃 QR 的店長有。`links` 給畫面上的 [列印](讀到之前 = null);`fetchLinks` 給交易後的自動列印。
 */
export const useReceiptLinks = () => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canPrint = hasPermission(PRINT_BUTTON_PERMISSIONS.print);
  const query = useLotteryReceiptLinksQuery(session.client, undefined, {
    enabled: canPrint,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const fetchLinks = useCallback(async (): Promise<ReceiptLinks> => {
    // 沒有列印權限:不會印,也查不到(api 守 `api.printing.print`)
    if (!canPrint) {
      return linksOf(NO_ROUTES);
    }
    const data = await queryClient.fetchQuery({
      queryKey: useLotteryReceiptLinksQuery.getKey(),
      queryFn: useLotteryReceiptLinksQuery.fetcher(session.client),
      staleTime: Number.POSITIVE_INFINITY,
    });
    return linksOf(data.lotteryReceiptLinks);
  }, [canPrint, queryClient, session.client]);
  const data = query.data?.lotteryReceiptLinks;
  return {
    links: data === undefined ? null : linksOf(data),
    fetchLinks,
  };
};
