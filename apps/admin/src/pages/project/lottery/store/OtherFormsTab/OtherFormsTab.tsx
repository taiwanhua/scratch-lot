import {
  CASH_CORRECTION_FORM_KEY,
  CHECKOUT_CONFIRM_FORM_KEY,
  SALE_REVERSAL_FORM_KEY,
  STOCKTAKE_CONFIRM_FORM_KEY,
} from "@repo/domain/project/lottery";

import { FormListPage } from "@/components/base/form-engine/FormModulePages/FormListPage";
import type { ModulePageProps } from "@/lib/base/module-tree";

/**
 * 店面管理內建的四張表單:各有自己的分頁或入口(撤銷售出、現金更正分頁;盤點、交班 / 日結從看板進),
 * 結帳確認申請的新增頁要帶班次(`?shift=`),不能從通用的 [+ 新增] 進。
 */
const BUILTIN_STORE_FORM_KEYS: readonly string[] = [
  SALE_REVERSAL_FORM_KEY,
  CASH_CORRECTION_FORM_KEY,
  STOCKTAKE_CONFIRM_FORM_KEY,
  CHECKOUT_CONFIRM_FORM_KEY,
];

/**
 * 「其他申請」分頁(規格 6.1):租戶自己綁到店面管理的表單,沿用表單引擎的預設列表(搜尋、篩選、新增、作廢);
 * 內建的四張不列(列表、表單篩選、[+ 新增] 都排除)。
 */
export const OtherFormsTab = (props: ModulePageProps) => (
  <FormListPage {...props} excludeFormKeys={BUILTIN_STORE_FORM_KEYS} />
);
