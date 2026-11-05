import { z } from "zod";

import {
  type CountMode,
  isMatchingCountMode,
  refundDefaultOf,
} from "@repo/domain/project/lottery";
import { useLotteryStoreSaleReversalOptionsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { readLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { ticketCashPointIdOf } from "../sale-reversal-form";
import {
  SALE_REVERSAL_PREFILL,
  SALE_REVERSAL_STOCK_PLACE,
} from "../store-forms-keys";

const prefillSchema = z.string().default("");

/** 網址帶入的值(全店重刷、依張數撤銷不符條件)。 */
export interface SaleReversalPrefill {
  /** 原因(重刷 = 盤點錯誤) */
  reason: string;
  /** 「遊戲 + 張數」列 */
  game: string;
  point: string;
  count: string;
  /** 退款給客人的初始值:依帶入原因的預設(盤點錯誤 = 否) */
  refund: boolean;
}

/** 讀網址帶入的原因與「遊戲 + 張數」列(只在第一次畫時用來給初始值)。 */
export const useSaleReversalPrefill = (): SaleReversalPrefill => {
  const [reason] = useUrlState(SALE_REVERSAL_PREFILL.reason, prefillSchema);
  const [game] = useUrlState(SALE_REVERSAL_PREFILL.game, prefillSchema);
  const [point] = useUrlState(SALE_REVERSAL_PREFILL.point, prefillSchema);
  const [count] = useUrlState(SALE_REVERSAL_PREFILL.count, prefillSchema);
  return {
    reason,
    game,
    point,
    count,
    refund: refundDefaultOf(reason === "" ? null : reason),
  };
};

/**
 * 撤銷售出申請新增頁的張數店部分(張數店規格 7.3 第 1、3 點、13.2):這家店的盤點制度(張數店與轉換中 = `matching`:
 * 刷的票送出時對號、可加「依遊戲 + 張數」)、啟用中的收銀點、本機收銀點,與依張號各列記的位置
 * (重刷帶入的位置;沒帶 = 本機收銀點)。`loaded` = 盤點制度讀到了。
 */
export const useSaleReversalCountStore = (orgId: string) => {
  const { session } = useSession();
  const [place] = useUrlState(SALE_REVERSAL_PREFILL.place, prefillSchema);
  const options = useLotteryStoreSaleReversalOptionsQuery(
    session.client,
    { orgId, cashPointId: null },
    { enabled: orgId !== "" },
  );
  const data = options.data?.lotteryStoreSaleReversalOptions;
  const matching = isMatchingCountMode(
    (data?.countMode ?? "numbered") as CountMode,
  );
  const cashPoints = data?.cashPoints ?? [];
  const stored = orgId === "" ? null : readLocalCashPoint(orgId);
  const localCashPointId = cashPoints.some((point) => point.id === stored)
    ? stored
    : null;
  return {
    loaded: data !== undefined,
    matching,
    cashPoints,
    localCashPointId,
    ticketCashPointId: ticketCashPointIdOf(
      place,
      SALE_REVERSAL_STOCK_PLACE,
      localCashPointId,
    ),
  };
};
