import { ContactFormPage } from "@/pages/project/lottery/dealers/ContactFormPage/ContactFormPage";
import { ContactViewPage } from "@/pages/project/lottery/dealers/ContactViewPage/ContactViewPage";
import { DealerFormPage } from "@/pages/project/lottery/dealers/DealerFormPage/DealerFormPage";
import { DealerViewPage } from "@/pages/project/lottery/dealers/DealerViewPage/DealerViewPage";
import { DealersPage } from "@/pages/project/lottery/dealers/DealersPage/DealersPage";
import { DEALERS_MODULE_KEYS } from "@/pages/project/lottery/dealers/dealers-keys";
import { GameFormPage } from "@/pages/project/lottery/master-data/GameFormPage/GameFormPage";
import { GameViewPage } from "@/pages/project/lottery/master-data/GameViewPage/GameViewPage";
import { MasterDataPage } from "@/pages/project/lottery/master-data/MasterDataPage/MasterDataPage";
import { MASTER_DATA_MODULE_KEYS } from "@/pages/project/lottery/master-data/master-data-config";

import type { ModulePageSource } from "../module-page-registry";

/**
 * 專案的模組頁面來源:專案自己新增的模組在此登記(頁面放 `pages/project/`),底座更新不會動到這份。
 *
 * - 固定頁寫進 `pages`;表單模組寫進 `forms`(四頁用表單引擎的預設組裝,單頁客製用 `pageOverrides`)
 * - key 不可與底座或彼此相撞;要換掉底座的頁不是在這裡撞 key,而是寫進 `page-replacements.ts`
 * - 登記不等於授權:進不進得去仍看 `me.modules`
 */
export const projectModulePages: ModulePageSource = {
  pages: [
    // 檔案管理(遊戲 | 收銀點);遊戲的新增 / 編輯共版型
    { key: MASTER_DATA_MODULE_KEYS.list, Page: MasterDataPage },
    { key: MASTER_DATA_MODULE_KEYS.gameViewPage, Page: GameViewPage },
    { key: MASTER_DATA_MODULE_KEYS.gameCreatePage, Page: GameFormPage },
    { key: MASTER_DATA_MODULE_KEYS.gameEditPage, Page: GameFormPage },
    // 經銷商管理(專案規格 5.2–5.4;新增與編輯同一個版型,情境由 module.key 判斷)
    { key: DEALERS_MODULE_KEYS.list, Page: DealersPage },
    { key: DEALERS_MODULE_KEYS.viewPage, Page: DealerViewPage },
    { key: DEALERS_MODULE_KEYS.createPage, Page: DealerFormPage },
    { key: DEALERS_MODULE_KEYS.editPage, Page: DealerFormPage },
    { key: DEALERS_MODULE_KEYS.contactViewPage, Page: ContactViewPage },
    { key: DEALERS_MODULE_KEYS.contactCreatePage, Page: ContactFormPage },
    { key: DEALERS_MODULE_KEYS.contactEditPage, Page: ContactFormPage },
  ],
  forms: [],
};
