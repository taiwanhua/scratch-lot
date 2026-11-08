import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { SALE_REVERSAL_STOCKTAKE_ERROR } from "@repo/domain/project/lottery-fields";
import { Button } from "@repo/ui/button";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useModuleForms } from "@/hooks/base/useModuleForms";

import {
  SALE_REVERSAL_FORM_KEY,
  SALE_REVERSAL_PREFILL,
  SALE_REVERSAL_STOCK_PLACE,
  STORE_KEY,
  storeFormCreateHref,
} from "./store-forms-keys";

export interface SendReversalButtonProps {
  /** 要撤銷的那一張(帶入新增頁)。 */
  ticketId?: string;
  /** 看板的分店。 */
  orgId: string;
  /**
   * 全店重刷「記已售但還在」(張數店規格 7.3 第 4 點):重刷刷到的位置(收銀點 id;庫存 = null)。
   * 給了 = 帶入原因「盤點錯誤」、不退款,核准後張回到這個位置。
   */
  rescanPlace?: string | null;
  /** 依張數撤銷不符條件(張數店規格 13.2):帶入「遊戲 + 張數」列。 */
  countLine?: { gameId: string; cashPointId: string; count: number };
}

/**
 * 不符合當下撤銷時的 [送撤銷售出申請](Figma ST-08b;規格 6.3;張數店的「不能銷售」視窗、全店重刷結果、依張數撤銷視窗):
 * 開撤銷售出申請的新增頁並帶入那一張(`?ticket=<張 id>&org=<分店>`;重刷另帶 `place`、`reason`)或「遊戲 + 張數」列
 * (`game`、`point`、`count`)。沒有 `store.create-sale_reversal`(表單此刻不能新增)就不顯示。
 */
export const SendReversalButton = ({
  ticketId,
  orgId,
  rescanPlace,
  countLine,
}: SendReversalButtonProps) => {
  const t = useTranslations("admin.lotteryStore.undoRequest");
  const navigate = useNavigate();
  const access = useFormModuleAccess(STORE_KEY);
  const { creatableForms } = useModuleForms(STORE_KEY);
  const createRoute = access.createRoute;
  if (
    createRoute === null ||
    !creatableForms.some((form) => form.key === SALE_REVERSAL_FORM_KEY)
  ) {
    return null;
  }
  const P = SALE_REVERSAL_PREFILL;
  const params: Record<string, string> = {
    [P.org]: orgId,
    ...(ticketId === undefined ? {} : { [P.ticket]: ticketId }),
    ...(rescanPlace === undefined
      ? {}
      : {
          [P.place]: rescanPlace ?? SALE_REVERSAL_STOCK_PLACE,
          [P.reason]: SALE_REVERSAL_STOCKTAKE_ERROR,
        }),
    ...(countLine === undefined
      ? {}
      : {
          [P.game]: countLine.gameId,
          [P.point]: countLine.cashPointId,
          [P.count]: String(countLine.count),
        }),
  };
  return (
    <Button
      onClick={() => {
        void navigate(
          storeFormCreateHref(createRoute, SALE_REVERSAL_FORM_KEY, params),
        );
      }}
    >
      {t("send")}
    </Button>
  );
};
