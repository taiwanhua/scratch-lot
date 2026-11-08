import {
  LOTTERY_SETTINGS_KEY,
  LOTTERY_SETTINGS_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-settings";

import { type ModuleRoleGrants, everything } from "../roles";

/**
 * 刮刮樂設定(張數店規格第 4、12 節;權限表正本 `docs/modules/project/lottery-settings.md`):
 * 總部管理全部、店長只給 `view`、店員不給。
 */
export const lotterySettingsGrants: ModuleRoleGrants = {
  section: "刮刮樂設定",
  grants: {
    hq: {
      moduleKeys: [LOTTERY_SETTINGS_KEY],
      permissionKeys: [everything(LOTTERY_SETTINGS_KEY)],
    },
    "store-manager": {
      moduleKeys: [LOTTERY_SETTINGS_KEY],
      permissionKeys: [PERMISSIONS.view],
    },
  },
};
