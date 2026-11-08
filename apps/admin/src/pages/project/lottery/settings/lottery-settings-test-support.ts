import { HttpResponse } from "msw";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  ALL_LOTTERY_SETTINGS_PERMISSIONS,
  lotterySettingsModules,
  lotterySettingsOrgs,
} from "@/test/msw/project/lottery/lottery-settings-fixtures";
import {
  type LotterySettingsWorldOptions,
  lotterySettingsWorld,
} from "@/test/msw/project/lottery/lottery-settings-handlers";
import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";
import { renderApp } from "@/test/render";

const { tenant, zhongshan, minsheng, hsinchu } = lotterySettingsOrgs;

/**
 * 刮刮樂設定測試的共用場景:路由、殼、守門都是真的,只有 api 是假的(`lotterySettingsWorld`)。
 * 當前組織預設 = 中山店;分店選擇器的組織樹 = 好運彩券行 ─ 中山店、民生店、新竹店。
 */
export const renderLotterySettings = ({
  path = "/lottery-settings",
  permissions = ALL_LOTTERY_SETTINGS_PERMISSIONS,
  currentOrg = zhongshan,
  world = {},
}: {
  path?: string;
  permissions?: readonly string[];
  currentOrg?: { id: string; name: string };
  world?: LotterySettingsWorldOptions;
} = {}) => {
  const fake = lotterySettingsWorld({
    permissions,
    currentOrgId: currentOrg.id,
    ...world,
  });
  server.use(
    ...fake.handlers,
    api.query("TenantOrgTree", () =>
      HttpResponse.json({
        data: {
          tenantOrgTree: toTenantTree([
            {
              ...tenant,
              children: [
                { ...zhongshan, parentId: tenant.id },
                { ...minsheng, parentId: tenant.id },
                { ...hsinchu, parentId: tenant.id },
              ],
            },
          ]),
        },
      }),
    ),
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [currentOrg],
      modules: [overviewModule, ...lotterySettingsModules(permissions)],
    }).handlers,
  );
  return { ...renderApp({ path }), fake };
};
