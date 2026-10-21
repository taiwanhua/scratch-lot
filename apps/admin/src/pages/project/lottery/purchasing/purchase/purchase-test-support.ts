import { authWorld } from "@/test/msw/auth-handlers";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import {
  type PrintButtonWorldOptions,
  printButtonWorld,
  printingModule,
} from "@/test/msw/print-button-handlers";
import { accountsWorld } from "@/test/msw/project/lottery/accounts-handlers";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import {
  purchaseFormWorld,
  purchaseModules,
} from "@/test/msw/project/lottery/purchase-fixtures";
import {
  type PurchaseWorldOptions,
  purchaseWorld,
} from "@/test/msw/project/lottery/purchase-handlers";
import { purchasingModules } from "@/test/msw/project/lottery/purchasing-fixtures";
import { redemptionWorld } from "@/test/msw/project/lottery/redemption-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

export interface RenderPurchaseOptions {
  path: string;
  /** 拿掉的進貨單權限 key(其餘給滿) */
  omit?: readonly string[];
  /** 當前組織:預設中山店(店長);`tenant` = 站在最上層組織(總部) */
  currentOrg?: "storeA" | "tenant";
  /**
   * 列印(58mm 單據):給了才有 `api.printing`(`permissions` 預設列印 + 補印)與列印的假伺服器;
   * 不給 = 沒有收據機的租戶,列印按鈕不出現、不自動列印
   */
  printing?: PrintButtonWorldOptions & { permissions?: string[] };
  /** 進貨單假 api 的選項(例:點收區塊的起始資料) */
  purchase?: PurchaseWorldOptions;
}

/**
 * 進貨單的測試場景:路由、殼、守門都是真的,只有 api 是假的(進貨單走表單執行端的 world;選項、點收、
 * 進度走 `purchaseWorld`;結算區塊走帳戶管理的 world)。
 */
export const renderPurchasePage = ({
  path,
  omit = [],
  currentOrg = "storeA",
  printing,
  purchase,
}: RenderPurchaseOptions) => {
  const purchaseFake = purchaseWorld(purchase);
  const formsFake = formRuntimeWorld(purchaseFormWorld());
  const accountsFake = accountsWorld();
  const org = masterDataOrgs[currentOrg];
  const printingFake =
    printing === undefined ? null : printButtonWorld(printing);
  server.use(
    ...(printingFake?.handlers ?? []),
    ...purchaseFake.handlers,
    // 新增頁的兌獎區(店內持有的兌獎紀錄)
    ...redemptionWorld().handlers,
    ...formsFake.handlers,
    ...accountsFake.handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [{ id: org.id, name: org.name }],
      currentOrgTenantId: masterDataOrgs.tenant.id,
      modules: [
        ...purchasingModules(),
        ...purchaseModules(omit),
        ...(printing === undefined
          ? []
          : [
              printingModule(
                printing.permissions ?? [
                  "api.printing.print",
                  "api.printing.reprint",
                ],
              ),
            ]),
      ],
    }).handlers,
  );
  return {
    ...renderApp({ path }),
    printingFake,
    purchaseFake,
    formsFake,
    accountsFake,
  };
};
