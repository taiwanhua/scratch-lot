import {
  LOTTERY_SETTINGS_KEY,
  LOTTERY_SETTINGS_PERMISSIONS,
} from "@repo/domain/project/lottery-settings";
import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "../../auth-handlers";

/** 刮刮樂設定的夾具(元件測試、假 api 與 mock 模式共用)。 */

export const ALL_LOTTERY_SETTINGS_PERMISSIONS = Object.values(
  LOTTERY_SETTINGS_PERMISSIONS,
);

/** 組織樹:好運彩券行(最上層)─┬─ 中山店、民生店、新竹店。 */
export const lotterySettingsOrgs = {
  tenant: { id: "org-ls-tenant", name: "好運彩券行" },
  zhongshan: { id: "org-ls-zhongshan", name: "中山店" },
  minsheng: { id: "org-ls-minsheng", name: "民生店" },
  hsinchu: { id: "org-ls-hsinchu", name: "新竹店" },
};

export const LOTTERY_SETTINGS_STORES = [
  lotterySettingsOrgs.zhongshan,
  lotterySettingsOrgs.minsheng,
  lotterySettingsOrgs.hsinchu,
];

/** 刮刮樂設定的模組(與 seed 宣告一致:一頁、order 75)。 */
export const lotterySettingsModules = (
  permissions: readonly string[] = ALL_LOTTERY_SETTINGS_PERMISSIONS,
): TestModule[] => [
  {
    __typename: "MeModule",
    id: `m-${LOTTERY_SETTINGS_KEY}`,
    key: LOTTERY_SETTINGS_KEY,
    name: "刮刮樂設定",
    parentId: null,
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 75,
    route: "/lottery-settings",
    icon: "tune",
    permissions: [...permissions],
  },
];
