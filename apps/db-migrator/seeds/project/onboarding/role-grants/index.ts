import type { ModuleRoleGrants } from "../roles";
import { accountsGrants } from "./accounts";
import { baseModuleGrants } from "./base-modules";
import { dealersGrants } from "./dealers";
import { inventoryGrants } from "./inventory";
import { masterDataGrants } from "./master-data";
import { purchasingGrants } from "./purchasing";
import { purchasingPurchaseGrants } from "./purchasing.purchase";
import { purchasingTransferGrants } from "./purchasing.transfer";
import { reportsGrants } from "./reports";
import { scheduleGrants } from "./schedule";

/**
 * 開通時建立的三個角色的權限配方(規格 3.3),**每個模組一段、一檔**。
 *
 * 追加方式(模組 owner 票):在本目錄新增 `<模組 key>.ts` 匯出一個 `ModuleRoleGrants`,
 * 只寫該模組自己的權限 key(模組宣告 `seeds/project/<模組>.ts` 已有的),再在下面的清單加一行。
 * 不改別的模組那一段。權限配方同時寫進 `docs/modules/project/<模組 key>.md` 的權限表。
 *
 * 開通腳本只對**新建的角色**套用配方;租戶已存在的角色(含已改過權限的)不覆蓋。
 * 配方裡租戶沒有開放的模組會略過並列在輸出裡。
 */
export const ROLE_GRANT_SECTIONS: readonly ModuleRoleGrants[] = [
  baseModuleGrants,
  masterDataGrants,
  dealersGrants,
  reportsGrants,
  scheduleGrants,
  accountsGrants,
  purchasingGrants,
  inventoryGrants,
  purchasingPurchaseGrants,
  purchasingTransferGrants,
];
