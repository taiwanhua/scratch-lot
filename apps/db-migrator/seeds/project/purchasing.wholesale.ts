import { WHOLESALE_MODULE_KEY } from "@repo/domain/project/lottery";

import { formModuleDeclaration } from "../base/form-module-declaration";
import type { ModuleSeedDeclaration } from "../base/module-declaration";
import { PURCHASING_GROUP_KEY } from "./purchasing";

/**
 * 叫貨與進貨 → 批售單(規格 21.8;正本 `docs/modules/project/purchasing.md`「批售單」)。
 * 表單模組(綁定 批售單 `wholesale`)、表單四條 + `receive`(結算區的 [收款] [退款] [沖正])。
 * 側欄計數「出貨確認」由 api 登記。
 */
export const purchasingWholesaleModule: ModuleSeedDeclaration =
  formModuleDeclaration({
    key: WHOLESALE_MODULE_KEY,
    name: "批售單",
    parentKey: PURCHASING_GROUP_KEY,
    route: "wholesale",
    order: 4,
    icon: "receipt",
    description:
      "批售單(表單模組,綁定 批售單):分店把未拆的整本賣給批售客戶,店長出貨確認,收款照結算",
    permissions: [
      {
        action: "receive",
        name: "收款",
        description: "批售單結算區塊的 [收款] [退款] [沖正]",
      },
    ],
  });
