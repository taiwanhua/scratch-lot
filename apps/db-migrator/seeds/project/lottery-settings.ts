import {
  LOTTERY_SETTINGS_KEY,
  LOTTERY_SETTINGS_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-settings";

import type { ModuleSeedDeclaration } from "../base/module-declaration";

/**
 * 刮刮樂設定(張數店規格第 4 節、5.7、12;正本 `docs/modules/project/lottery-settings.md`):
 * 側欄獨立一頁,排在檔案管理(`order: 70`)之後、班表管理(`order: 80`)之前。一頁一條設定一列,
 * 沒有隱藏頁。權限分法同排班規則:`edit-default` 改最上層組織的預設、`edit-org` 改其他組織。
 * 不宣告資料範圍目標。
 */
export const lotterySettingsModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: LOTTERY_SETTINGS_KEY,
      name: "刮刮樂設定",
      sidebarType: "link",
      parentKey: null,
      order: 75,
      route: "lottery-settings",
      icon: "tune",
      description: "盤點制度、補點編號、調貨單選張等刮刮樂的設定(沿組織樹繼承)",
    },
  ],
  permissions: [
    {
      key: PERMISSIONS.view,
      moduleKey: LOTTERY_SETTINGS_KEY,
      name: "檢視",
      description: "看設定頁與盤點制度的變更紀錄",
    },
    {
      key: PERMISSIONS.editDefault,
      moduleKey: LOTTERY_SETTINGS_KEY,
      name: "改預設",
      description: "最上層組織的 [自訂] / [還原](各分店沿用的預設)",
    },
    {
      key: PERMISSIONS.editOrg,
      moduleKey: LOTTERY_SETTINGS_KEY,
      name: "改區域與分店",
      description: "區域、分店的 [自訂] / [還原]、[取消轉換]",
    },
  ],
};
