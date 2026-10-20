import { authWorld } from "@/test/msw/auth-handlers";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import {
  purchasingModules,
  requisitionFormWorld,
} from "@/test/msw/project/lottery/purchasing-fixtures";
import {
  type PurchasingWorldOptions,
  purchasingWorld,
} from "@/test/msw/project/lottery/purchasing-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

export interface RenderPurchasingOptions {
  path: string;
  /** 拿掉的權限 key(其餘給滿) */
  omit?: readonly string[];
  /** 當前組織:預設中山店(店長);`tenant` = 站在最上層組織(總部) */
  currentOrg?: "storeA" | "tenant";
  purchasing?: PurchasingWorldOptions;
  forms?: FormRuntimeWorldOptions;
}

/**
 * 叫貨、採購單的測試場景:路由、殼、守門都是真的,只有 api 是假的(叫貨單走表單執行端的 world;
 * 新增頁的遊戲清單、採購清單、衍生狀態走 `purchasingWorld`;分店選擇器的組織樹借用檔案管理夾具的那一棵)。
 */
export const renderPurchasingPage = ({
  path,
  omit = [],
  currentOrg = "storeA",
  purchasing = {},
  forms = requisitionFormWorld(),
}: RenderPurchasingOptions) => {
  const purchasingFake = purchasingWorld(purchasing);
  const formsFake = formRuntimeWorld(forms);
  const org = masterDataOrgs[currentOrg];
  server.use(
    ...purchasingFake.handlers,
    ...formsFake.handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [{ id: org.id, name: org.name }],
      currentOrgTenantId: masterDataOrgs.tenant.id,
      modules: purchasingModules(omit),
    }).handlers,
  );
  return { ...renderApp({ path }), purchasingFake, formsFake };
};
