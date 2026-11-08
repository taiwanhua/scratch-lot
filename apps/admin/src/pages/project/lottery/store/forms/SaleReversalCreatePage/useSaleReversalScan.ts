import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryStoreScanItemFieldsFragment,
  type LotteryStoreScanQuery,
  useLotteryStoreSaleQuery,
  useLotteryStoreScanQuery,
} from "@repo/graphql";

import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";

import {
  type ReversalScanKind,
  frontCodeOfTicketKey,
  reversalScanHitOf,
} from "../sale-reversal-form";
import { SALE_REVERSAL_SCAN_PURPOSE } from "../store-forms-keys";

export interface SaleReversalScanOptions {
  orgId: string;
  /** 張數店與轉換中:不是確定張號的已售也能加入(送出時對號) */
  matching: boolean;
  /** 盤點制度讀到了(帶入那一張要等它,才知道放格子還是「已對號」) */
  ready: boolean;
  /** 看板 / 重刷 [送撤銷售出申請] 帶入的那一張(張 id;沒有 = "") */
  prefillTicketId: string;
  onAdd: (
    item: LotteryStoreScanItemFieldsFragment,
    kind: ReversalScanKind,
  ) => void;
  onNotice: (text: string) => void;
}

/**
 * 撤銷售出申請新增頁的刷條碼 / 手輸(B10 掃描用途 `store-sale-reversal`):查 `lotteryStoreScan`,
 * 依 `reversalScanHitOf` 決定加進格子(確定張號的已售)或「已對號」(張數店規格 7.3 第 3 點),不能撤銷的給提示。
 * 帶入的那一張:讀那次售出的顯示鍵,換成正面編號去刷(本號對到多款遊戲時以張 id 對)。回傳刷一次的函式(手輸按 Enter 用)。
 */
export const useSaleReversalScan = ({
  orgId,
  matching,
  ready,
  prefillTicketId,
  onAdd,
  onNotice,
}: SaleReversalScanOptions) => {
  const t = useTranslations("admin.lotteryStore.saleReversal");
  const queryClient = useQueryClient();
  const { session } = useSession();

  const scan = (raw: string, wantedTicketId: string | null = null) => {
    if (orgId === "") {
      return;
    }
    const variables = { input: { orgId, code: raw, localCashPointId: null } };
    void queryClient
      .fetchQuery<LotteryStoreScanQuery>({
        queryKey: useLotteryStoreScanQuery.getKey(variables),
        queryFn: useLotteryStoreScanQuery.fetcher(session.client, variables),
        staleTime: 0,
      })
      .then((data) => {
        const items = data.lotteryStoreScan.items;
        if (items.length === 0) {
          onNotice(t("scanNotFound"));
          return;
        }
        const hit = reversalScanHitOf(items, wantedTicketId, matching);
        if (hit?.kind == null) {
          onNotice(
            matching ? t("scanNotReversibleCount") : t("scanNotReversible"),
          );
          return;
        }
        onAdd(hit.item, hit.kind);
      })
      .catch(() => {
        onNotice(t("scanNotFound"));
      });
  };
  useScanner(SALE_REVERSAL_SCAN_PURPOSE, ({ code }) => {
    scan(code);
  });

  const prefillSale = useLotteryStoreSaleQuery(
    session.client,
    { ticketId: prefillTicketId },
    { enabled: prefillTicketId !== "" },
  );
  const prefilled = useRef(false);
  const prefillKey = prefillSale.data?.lotteryStoreSale.item.ticketKey ?? null;
  useEffect(() => {
    if (prefilled.current || prefillKey === null || orgId === "" || !ready) {
      return;
    }
    const front = frontCodeOfTicketKey(prefillKey);
    if (front !== null) {
      prefilled.current = true;
      scan(front, prefillTicketId);
    }
  });

  return scan;
};
