import { type TestModule, authWorld } from "@/test/msw/auth-handlers";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
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
import { receiptLinksHandlers } from "@/test/msw/project/lottery/receipt-links-handlers";
import { redemptionWorld } from "@/test/msw/project/lottery/redemption-handlers";
import { server } from "@/test/msw/server";
import {
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";
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
  /** 表單執行端假 api 的覆寫(例:送出失敗的 `failures`) */
  forms?: Partial<FormRuntimeWorldOptions>;
  /** 審核實例與任務(審核區塊、申請中心詳情頁);不給 = 沒有審核的假 api */
  workflow?: WorkflowRuntimeWorldOptions;
  /** 另外給的模組(例:申請中心) */
  extraModules?: readonly TestModule[];
  /** false = 操作者沒有這個模組(只從申請中心進來的人;單據 QR 的路由仍依模組樹) */
  withModule?: boolean;
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
  forms,
  workflow,
  extraModules = [],
  withModule = true,
}: RenderPurchaseOptions) => {
  const purchaseFake = purchaseWorld(purchase);
  const formsFake = formRuntimeWorld(purchaseFormWorld(forms));
  const workflowFake =
    workflow === undefined ? null : workflowRuntimeWorld(workflow);
  const accountsFake = accountsWorld();
  const org = masterDataOrgs[currentOrg];
  const printingFake =
    printing === undefined ? null : printButtonWorld(printing);
  server.use(
    ...(printingFake?.handlers ?? []),
    ...(printing === undefined ? [] : receiptLinksHandlers()),
    ...(workflowFake?.handlers ?? []),
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
        ...(withModule ? purchaseModules(omit) : []),
        ...extraModules,
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
    workflowFake,
    purchaseFake,
    formsFake,
    accountsFake,
  };
};
