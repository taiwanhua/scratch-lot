import type { ProjectPublicConfig } from "../base/public-config";

/**
 * 專案的公開值(專案維護;底座升級不覆寫本檔)。登記於 docs/branding.md。
 * `slug` 是建立專案時定下的穩定識別,品牌更名不跟著改 —— 改了等於換一組瀏覽器儲存鍵。
 */
export const projectPublic = {
  slug: "scratch-lot",
  brand: {
    name: "scratch-lot",
    primary: "#FFD700",
  },
  admin: {
    documentTitle: "scratch-lot 後台管理",
  },
  front: {
    metadata: {
      "zh-TW": {
        title: "scratch-lot — ScratchLot 刮刮樂智慧管理系統",
        titleTemplate: "%s | scratch-lot",
        description: "ScratchLot 刮刮樂智慧管理系統",
      },
      en: {
        title: "scratch-lot — ScratchLot Smart Scratch-off Lottery Management System",
        titleTemplate: "%s | scratch-lot",
        description: "ScratchLot Smart Scratch-off Lottery Management System",
      },
    },
  },
  compatibility: {
    // 早期點分隔的側欄收合鍵;有既存瀏覽器值要搬的專案才填,新專案為 null
    legacySideNavStorageKey: null,
  },
} satisfies ProjectPublicConfig;
