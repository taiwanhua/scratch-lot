import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useModuleForms } from "@/hooks/base/useModuleForms";

import {
  SALE_REVERSAL_FORM_KEY,
  SALE_REVERSAL_PREFILL,
  STORE_KEY,
  storeFormCreateHref,
} from "./store-forms-keys";

export interface SendReversalButtonProps {
  /** 要撤銷的那一張(帶入新增頁)。 */
  ticketId: string;
  /** 看板的分店。 */
  orgId: string;
}

/**
 * 撤銷售出確認視窗不符合當下撤銷時的 [送撤銷售出申請](Figma ST-08b;規格 6.3):開撤銷售出申請的新增頁並帶入
 * 那一張(`?ticket=<張 id>&org=<分店>`)。沒有 `store.create-sale_reversal`(表單此刻不能新增)就不顯示。
 */
export const SendReversalButton = ({
  ticketId,
  orgId,
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
  return (
    <Button
      onClick={() => {
        void navigate(
          storeFormCreateHref(createRoute, SALE_REVERSAL_FORM_KEY, {
            [SALE_REVERSAL_PREFILL.ticket]: ticketId,
            [SALE_REVERSAL_PREFILL.org]: orgId,
          }),
        );
      }}
    >
      {t("send")}
    </Button>
  );
};
