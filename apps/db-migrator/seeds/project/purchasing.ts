import { REQUISITION_MODULE_KEY } from "@repo/domain/project/lottery";

import { formModuleDeclaration } from "../base/form-module-declaration";
import type { ModuleSeedDeclaration } from "../base/module-declaration";

/**
 * 叫貨與進貨(群組)與叫貨、採購單(規格 3.1、3.2、8.1;正本 `docs/modules/project/purchasing.md`)。
 * 群組與 `purchasing.requisition` 由本檔一次宣告全部權限;進貨單 `purchasing.purchase`、調貨單
 * `purchasing.transfer` 由各自的票另檔宣告,掛在本群組底下。
 *
 * - `purchasing.requisition`:表單模組(綁定 叫貨單 `requisition`),頁內分頁 叫貨單 | 採購清單;
 *   表單四條 + `purchase-list`(採購清單分頁)
 */
export const PURCHASING_GROUP_KEY = "purchasing";

export const purchasingGroupModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: PURCHASING_GROUP_KEY,
      name: "叫貨與進貨",
      sidebarType: "group",
      parentKey: null,
      order: 30,
      route: "purchasing",
      icon: "receipt",
      description: "叫貨、採購單、進貨單、調貨單",
    },
  ],
};

export const purchasingRequisitionModule: ModuleSeedDeclaration =
  formModuleDeclaration({
    key: REQUISITION_MODULE_KEY,
    name: "叫貨、採購單",
    parentKey: PURCHASING_GROUP_KEY,
    route: "requisition",
    order: 1,
    icon: "receipt",
    description:
      "叫貨單(表單模組,綁定 叫貨單)與採購清單:分店叫貨、總部依遊戲 × 分店彙總後採購",
    permissions: [
      {
        action: "purchase-list",
        name: "採購清單",
        description: "看採購清單分頁、匯出 Excel",
      },
    ],
  });

/** 群組 + 叫貨、採購單(父在前)。 */
export const purchasingModuleDeclarations: readonly ModuleSeedDeclaration[] = [
  purchasingGroupModule,
  purchasingRequisitionModule,
];
