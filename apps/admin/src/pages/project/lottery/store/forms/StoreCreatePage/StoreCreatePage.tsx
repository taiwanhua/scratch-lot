import {
  CHECKOUT_CONFIRM_FORM_KEY,
  STOCKTAKE_CONFIRM_FORM_KEY,
} from "@repo/domain/project/lottery";

import { FormCreatePage } from "@/components/base/form-engine/FormModulePages/FormCreatePage";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { CheckoutCreatePage } from "../../checkout/CheckoutWizardPage";
import { StocktakeCreatePage } from "../../stocktake/StocktakeFormPages";
import { SaleReversalCreatePage } from "../SaleReversalCreatePage/SaleReversalCreatePage";
import { SALE_REVERSAL_FORM_KEY } from "../store-forms-keys";

/**
 * 店面管理的新增頁(`store.create-page`;網址 `/store/create-page/<formKey>`):撤銷售出申請換成替換新增頁
 * (Figma ST-31b);盤點確認申請換成盤點頁(臨時盤點,Figma ST-13);結帳確認申請換成交班精靈(Figma ST-17a–19b);
 * 其他表單(現金更正單、租戶自己綁的表單)沿用表單引擎的預設新增頁(規格 8.8「不替換頁面」)。
 */
export const StoreCreatePage = (props: ModulePageProps) => {
  if (props.routeParam === SALE_REVERSAL_FORM_KEY) {
    return <SaleReversalCreatePage />;
  }
  if (props.routeParam === STOCKTAKE_CONFIRM_FORM_KEY) {
    return <StocktakeCreatePage />;
  }
  if (props.routeParam === CHECKOUT_CONFIRM_FORM_KEY) {
    return <CheckoutCreatePage />;
  }
  return <FormCreatePage {...props} />;
};
