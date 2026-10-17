import { API_MODULE_KEY } from "../../../src/seed/seed-key-convention";
import {
  type ModuleSeedDeclaration,
  permissionKey,
} from "../module-declaration";

/** 列印的純 API 能力(底座規格第 6 章「權限」;docs/modules/printers.md)。 */
export const API_PRINTING_KEY = `${API_MODULE_KEY}.printing`;

/**
 * 隱藏的純 API 模組樹(ADR-0004「API 權限」):API 預設重用頁面權限 key,
 * 僅無對應頁面的純 API 能力放進此樹。不在側欄、不是頁面,故無 route;
 * 整棵子樹豁免「hidden 一律 `-page` 結尾」規則(seed-key-convention)。
 *
 * - `api.printing`:列印按鈕(各單據頁的元件,不屬於某一頁)的列印 / 補印。
 *   沒有收據機的租戶不授予,列印按鈕就不顯示。
 */
export const apiModules: ModuleSeedDeclaration = {
  nodes: [
    {
      key: API_MODULE_KEY,
      name: "API 能力",
      sidebarType: "hidden",
      parentKey: null,
      order: 99,
      icon: "tune",
      description: "無對應頁面的純 API 權限掛此樹(ADR-0004)",
    },
    {
      key: API_PRINTING_KEY,
      name: "列印",
      sidebarType: "hidden",
      parentKey: API_MODULE_KEY,
      order: 1,
      icon: "print",
      description: "各單據的列印按鈕:列印、補印(收據機經店內代理程式)",
    },
  ],
  permissions: [
    {
      key: permissionKey(API_PRINTING_KEY, "print"),
      moduleKey: API_PRINTING_KEY,
      name: "列印",
      description: "單據的 [列印] 按鈕 + API(建立列印工作)",
    },
    {
      key: permissionKey(API_PRINTING_KEY, "reprint"),
      moduleKey: API_PRINTING_KEY,
      name: "補印",
      description: "印過的單據的 [補印] 按鈕 + API(需選補印原因)",
    },
  ],
};
