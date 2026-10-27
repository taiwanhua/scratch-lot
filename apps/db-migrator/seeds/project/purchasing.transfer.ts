import { TRANSFER_MODULE_KEY } from "@repo/domain/project/lottery";

import { formModuleDeclaration } from "../base/form-module-declaration";
import type { ModuleSeedDeclaration } from "../base/module-declaration";
import { PURCHASING_GROUP_KEY } from "./purchasing";

/**
 * 叫貨與進貨 → 調貨單(規格 3.1、3.2、8.4;正本 `docs/modules/project/purchasing.md`「調貨單」)。
 * 本檔一次宣告全部權限(後續票不改):表單模組(綁定 調貨單 `transfer`)、表單四條 + `partial-tickets`
 * (零碎張數)、`pay`(收貨店付款 / 收到退款)、`receive`(出貨店收款 / 退款)。側欄計數「待點收」由 api 登記。
 */
export const purchasingTransferModule: ModuleSeedDeclaration =
  formModuleDeclaration({
    key: TRANSFER_MODULE_KEY,
    name: "調貨單",
    parentKey: PURCHASING_GROUP_KEY,
    route: "transfer",
    order: 3,
    icon: "receipt",
    description:
      "調貨單(表單模組,綁定 調貨單):分店之間調本或零碎張數,出貨店確認出貨、收貨店逐本點收、兩邊結算調貨款",
    permissions: [
      {
        action: "partial-tickets",
        name: "零碎張數",
        description: "調貨單選張(只有拆過的本能選張)",
      },
      {
        action: "pay",
        name: "收貨店付款",
        description: "調貨單結算區塊收貨店的 [付款] [收到退款] [沖正]",
      },
      {
        action: "receive",
        name: "出貨店收款",
        description: "調貨單結算區塊出貨店的 [收款] [退款] [沖正]",
      },
    ],
  });
