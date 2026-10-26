import { PURCHASE_MODULE_KEY } from "@repo/domain/project/lottery";

import { formModuleDeclaration } from "../base/form-module-declaration";
import type { ModuleSeedDeclaration } from "../base/module-declaration";
import { PURCHASING_GROUP_KEY } from "./purchasing";

/**
 * 叫貨與進貨 → 進貨單(規格 3.1、3.2、8.2;正本 `docs/modules/project/purchasing.md`「進貨單」)。
 * 本檔一次宣告全部權限(後續票不改):表單模組(綁定 進貨單 `purchase`)、表單四條 + `settle`
 * (結算區塊的 [付款] [收到退款] [沖正])。側欄計數「待點收」由 api 登記(`registerBadge`)。
 */
export const purchasingPurchaseModule: ModuleSeedDeclaration =
  formModuleDeclaration({
    key: PURCHASE_MODULE_KEY,
    name: "進貨單",
    parentKey: PURCHASING_GROUP_KEY,
    route: "purchase",
    order: 2,
    icon: "receipt",
    description:
      "進貨單(表單模組,綁定 進貨單):總部向甲類批購、分店店長逐本刷條碼點收、結算進貨款",
    permissions: [
      {
        action: "settle",
        name: "結算",
        description: "進貨單結算區塊的 [付款] [收到退款] [沖正]",
      },
    ],
  });
