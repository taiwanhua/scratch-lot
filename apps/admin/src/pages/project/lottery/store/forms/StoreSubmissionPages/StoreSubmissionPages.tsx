import {
  CHECKOUT_CONFIRM_FORM_KEY,
  STOCKTAKE_CONFIRM_FORM_KEY,
} from "@repo/domain/project/lottery";

import { FormEditPage } from "@/components/base/form-engine/FormModulePages/FormEditPage";
import { FormViewPage } from "@/components/base/form-engine/FormModulePages/FormViewPage";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { CheckoutViewPage } from "../../checkout/CheckoutViewPage";
import { CheckoutConfirmEditPage } from "../../daily-close/CheckoutConfirmPages";
import { StocktakeEditPage } from "../../stocktake/StocktakeFormPages";
import { StocktakeViewPage } from "../../stocktake/StocktakeViewPage";

/** 那一筆提交的表單代號(讀到之前 = null)。 */
const useFormKeyOf = (props: ModulePageProps): string | null =>
  useFormSubmission(props.routeParam ?? "").submission?.formKey ?? null;

/**
 * 店面管理的檢視頁(`store.view-page/<id>`):盤點確認申請換成盤點單明細 + 審核(Figma ST-30);
 * 結帳確認申請換成結帳單明細 + 審核(Figma ST-28a 交班 / ST-28b 日結);其他表單沿用表單引擎的預設檢視頁。表單代號要讀到那一筆才知道,讀到之前不畫。
 */
export const StoreViewPage = (props: ModulePageProps) => {
  const formKey = useFormKeyOf(props);
  if (formKey === null) {
    return null;
  }
  if (formKey === STOCKTAKE_CONFIRM_FORM_KEY) {
    return <StocktakeViewPage {...props} />;
  }
  if (formKey === CHECKOUT_CONFIRM_FORM_KEY) {
    return <CheckoutViewPage {...props} />;
  }
  return <FormViewPage {...props} />;
};

/**
 * 店面管理的編輯頁(`store.edit-page/<id>`):已退回的盤點確認申請打開盤點頁、帶入原內容(規格 8.6);
 * 已退回的結帳確認申請依類型打開交班 / 日結精靈、帶入原內容(規格 8.7);其他表單沿用表單引擎的預設編輯頁。
 */
export const StoreEditPage = (props: ModulePageProps) => {
  const formKey = useFormKeyOf(props);
  if (formKey === null) {
    return null;
  }
  if (formKey === STOCKTAKE_CONFIRM_FORM_KEY) {
    return <StocktakeEditPage {...props} />;
  }
  if (formKey === CHECKOUT_CONFIRM_FORM_KEY) {
    return <CheckoutConfirmEditPage {...props} />;
  }
  return <FormEditPage {...props} />;
};
