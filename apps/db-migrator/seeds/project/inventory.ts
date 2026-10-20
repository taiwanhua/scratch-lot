import {
  INVENTORY_KEY,
  INVENTORY_MODULE_KEYS as KEYS,
  INVENTORY_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery";

import type { ModuleSeedDeclaration } from "../base/module-declaration";

/**
 * 庫存管理(專案規格 3.1、3.2、第 7 章;正本 `docs/modules/project/inventory.md`):
 * 一頁三個分頁(庫存 | 待查·遺失 | 預計要給本數)+ 查刮刮樂,分頁不是模組節點;本的詳情是隱藏頁。
 * 一次宣告整個模組的全部權限,之後同模組的票不改這份宣告。本模組沒有 `view` 權限(規格 3.2):
 * 讀取看模組有沒有綁。不宣告資料範圍目標(本 / 張 / 事件 / 預計要給本數四張帳本表不能是目標,
 * `inventory-data-scope.test.ts` 鎖住)。
 */
export const inventoryModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: INVENTORY_KEY,
      name: "庫存管理",
      sidebarType: "link",
      parentKey: null,
      order: 20,
      route: "inventory",
      icon: "inventory",
      description: "庫存、待查·遺失、預計要給本數與查刮刮樂",
    },
    {
      key: KEYS.bookPage,
      name: "本的詳情",
      sidebarType: "hidden",
      parentKey: INVENTORY_KEY,
      order: 1,
      route: "book-page",
    },
  ],
  permissions: [
    {
      key: PERMISSIONS.markSkipped,
      moduleKey: INVENTORY_KEY,
      name: "更正跳號",
      description: "本的詳情頁 [更正跳號]",
    },
    {
      key: PERMISSIONS.recover,
      moduleKey: INVENTORY_KEY,
      name: "尋回",
      description:
        "待查 / 遺失的張 [尋回](本的詳情頁、待查·遺失分頁、刷到時的提示)",
    },
    {
      key: PERMISSIONS.scrap,
      moduleKey: INVENTORY_KEY,
      name: "報廢",
      description: "本的詳情頁選未售的張 [報廢]",
    },
    {
      key: PERMISSIONS.showCost,
      moduleKey: INVENTORY_KEY,
      name: "顯示成本",
      description: "本的詳情頁的成本、待查·遺失與報廢的批購成本",
    },
    {
      key: PERMISSIONS.editAllocations,
      moduleKey: INVENTORY_KEY,
      name: "修改預計要給本數",
      description:
        "預計要給本數點格子修改(庫存管理、遊戲詳情、乙類詳情);沒有時唯讀",
    },
  ],
};
