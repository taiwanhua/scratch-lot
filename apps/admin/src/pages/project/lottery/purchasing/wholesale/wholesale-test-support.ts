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
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import { purchasingModules } from "@/test/msw/project/lottery/purchasing-fixtures";
import { receiptLinksHandlers } from "@/test/msw/project/lottery/receipt-links-handlers";
import {
  wholesaleFormWorld,
  wholesaleModules,
} from "@/test/msw/project/lottery/wholesale-fixtures";
import {
  type WholesaleWorldOptions,
  wholesaleWorld,
} from "@/test/msw/project/lottery/wholesale-handlers";
import { server } from "@/test/msw/server";
import {
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";
import { renderApp } from "@/test/render";

export interface RenderWholesaleOptions {
  path: string;
  /** 拿掉的批售單權限 key(其餘給滿) */
  omit?: readonly string[];
  /** 當前組織:預設中山店(店長);`tenant` = 站在最上層組織(總部) */
  currentOrg?: "storeA" | "tenant";
  /** 批售單表單執行端的覆寫 */
  forms?: Partial<FormRuntimeWorldOptions>;
  /** 審核實例與任務;不給 = 沒有審核的假 api */
  workflow?: WorkflowRuntimeWorldOptions;
  /** 另外給的模組(例:申請中心) */
  extraModules?: readonly TestModule[];
  wholesale?: WholesaleWorldOptions;
  /**
   * 列印(58mm 單據):給了才有 `api.printing`(`permissions` 預設列印 + 補印)與列印的假伺服器;
   * 不給 = 沒有收據機的租戶,列印按鈕不出現、不自動列印
   */
  printing?: PrintButtonWorldOptions & { permissions?: string[] };
}

/** 批售單的測試場景:路由、殼、守門都是真的,只有 api 是假的(表單執行端的 world + `wholesaleWorld`)。 */
export const renderWholesalePage = ({
  path,
  omit = [],
  currentOrg = "storeA",
  forms,
  workflow,
  extraModules = [],
  wholesale,
  printing,
}: RenderWholesaleOptions) => {
  const formsOptions = wholesaleFormWorld(forms);
  const wholesaleFake = wholesaleWorld({
    ...(formsOptions.submissions === undefined
      ? {}
      : { submissions: formsOptions.submissions }),
    ...wholesale,
  });
  const formsFake = formRuntimeWorld(formsOptions);
  const workflowFake =
    workflow === undefined ? null : workflowRuntimeWorld(workflow);
  const org = masterDataOrgs[currentOrg];
  const printingFake =
    printing === undefined ? null : printButtonWorld(printing);
  server.use(
    ...(printingFake?.handlers ?? []),
    ...(printing === undefined ? [] : receiptLinksHandlers()),
    ...(workflowFake?.handlers ?? []),
    ...wholesaleFake.handlers,
    ...formsFake.handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [{ id: org.id, name: org.name }],
      currentOrgTenantId: masterDataOrgs.tenant.id,
      modules: [
        ...purchasingModules(),
        ...wholesaleModules(omit),
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
    wholesaleFake,
    formsFake,
    workflowFake,
    printingFake,
  };
};
