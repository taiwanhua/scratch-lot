import { authWorld } from "@/test/msw/auth-handlers";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { accountsWorld } from "@/test/msw/project/lottery/accounts-handlers";
import { masterDataOrgs } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataSharedLookupHandlers } from "@/test/msw/project/lottery/master-data-handlers";
import { purchasingModules } from "@/test/msw/project/lottery/purchasing-fixtures";
import {
  transferFormWorld,
  transferModules,
} from "@/test/msw/project/lottery/transfer-fixtures";
import { transferWorld } from "@/test/msw/project/lottery/transfer-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

export interface RenderTransferOptions {
  path: string;
  /** 拿掉的調貨單權限 key(其餘給滿) */
  omit?: readonly string[];
  /** 當前組織:預設中山店(店長);`tenant` = 站在最上層組織(總部) */
  currentOrg?: "storeA" | "tenant";
}

/**
 * 調貨單的測試場景:路由、殼、守門都是真的,只有 api 是假的(調貨單走表單執行端的 world;選項、格子、
 * 點收、進度與調貨單的收付走 `transferWorld`;其他收付走帳戶管理的 world)。
 */
export const renderTransferPage = ({
  path,
  omit = [],
  currentOrg = "storeA",
}: RenderTransferOptions) => {
  const transferFake = transferWorld();
  const formsFake = formRuntimeWorld(transferFormWorld());
  const accountsFake = accountsWorld();
  const org = masterDataOrgs[currentOrg];
  server.use(
    ...transferFake.handlers,
    ...formsFake.handlers,
    ...accountsFake.handlers,
    ...masterDataSharedLookupHandlers(),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [{ id: org.id, name: org.name }],
      currentOrgTenantId: masterDataOrgs.tenant.id,
      modules: [...purchasingModules(), ...transferModules(omit)],
    }).handlers,
  );
  return { ...renderApp({ path }), transferFake, formsFake, accountsFake };
};
