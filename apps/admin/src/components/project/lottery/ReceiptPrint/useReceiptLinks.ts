import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { ACCOUNTS_TABS } from "@repo/domain/project/lottery-accounts";
import {
  type LotteryReceiptLinksFieldsFragment,
  useLotteryReceiptLinksQuery,
} from "@repo/graphql";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { PRINT_BUTTON_PERMISSIONS } from "@/lib/base/print-button";
import { logReceiptPrintFailure } from "@/lib/project/lottery/receipts/receipt-log";

/**
 * 單據底部 QR code 的連結(完整網址)。路由是 null(模組停用、沒有 route、還沒讀到或讀不到)→ 連結 = null,
 * 單據照印、不印 QR(自動列印怎樣都要印得出來)。
 */
export interface ReceiptLinks {
  /** 現金流水類(投庫、出庫、存款、調貨付款)沒有詳情頁 → 即時現金帳 `?movementId=`(打開時標亮那一筆,10.2) */
  cashLedgerUrl: (movementId: string) => string | null;
  /** 店面管理的申請(結帳確認申請、撤銷售出申請)→ 檢視頁 */
  storeViewUrl: (submissionId: string) => string | null;
  /** 進貨單 → 檢視頁 */
  purchaseViewUrl: (submissionId: string) => string | null;
  /** 調貨單 → 檢視頁 */
  transferViewUrl: (submissionId: string) => string | null;
}

/**
 * api 回的路由(`lotteryReceiptLinks`,或寫入 mutation 一起帶回的 `receiptLinks`)→ 完整網址。
 * 交易後的自動列印用寫入回傳的那一份,不另查。
 */
export const receiptLinksOf = (
  routes: LotteryReceiptLinksFieldsFragment,
): ReceiptLinks => {
  const origin = globalThis.location.origin;
  const urlOf = (route: string | null | undefined, rest: string) =>
    route === null || route === undefined ? null : `${origin}${route}${rest}`;
  return {
    cashLedgerUrl: (movementId) =>
      urlOf(
        routes.cashLedger,
        `?tab=${ACCOUNTS_TABS.cash}&movementId=${movementId}`,
      ),
    storeViewUrl: (submissionId) => urlOf(routes.storeView, `/${submissionId}`),
    purchaseViewUrl: (submissionId) =>
      urlOf(routes.purchaseView, `/${submissionId}`),
    transferViewUrl: (submissionId) =>
      urlOf(routes.transferView, `/${submissionId}`),
  };
};

const NO_ROUTES: LotteryReceiptLinksFieldsFragment = {
  cashLedger: null,
  storeView: null,
  purchaseView: null,
  transferView: null,
};

/**
 * 58mm 單據 QR code 的連結(規格第 12 章)。頁面路由由 api 依**模組樹**組(`lotteryReceiptLinks`),
 * **不依印單的人的權限** —— 不能用 `me.modules`(已依權限過濾):店員印的投庫單沒有帳戶管理,
 * 掃 QR 的店長有。
 *
 * - `links`:畫面上的 [列印] / [補印];讀到之前、讀不到 = 沒有連結(照印、不印 QR),按鈕不必等
 * - `fetchLinks`:交易後的自動列印(寫入回傳沒帶路由的那幾種);讀不到 → 沒有連結,照印、不印 QR
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
      return receiptLinksOf(NO_ROUTES);
    }
    try {
      const data = await queryClient.fetchQuery({
        queryKey: useLotteryReceiptLinksQuery.getKey(),
        queryFn: useLotteryReceiptLinksQuery.fetcher(session.client),
        staleTime: Number.POSITIVE_INFINITY,
      });
      return receiptLinksOf(data.lotteryReceiptLinks);
    } catch (error) {
      // 讀不到路由:照印、不印 QR(只記 log)
      logReceiptPrintFailure("links failed", { error });
      return receiptLinksOf(NO_ROUTES);
    }
  }, [canPrint, queryClient, session.client]);
  const data = query.data?.lotteryReceiptLinks;
  return {
    links: receiptLinksOf(data ?? NO_ROUTES),
    fetchLinks,
  };
};
