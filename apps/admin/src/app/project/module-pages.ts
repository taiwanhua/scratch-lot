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
import { ReportsPage } from "@/pages/project/lottery/reports/ReportsPage/ReportsPage";
import { ScheduleAttendancePage } from "@/pages/project/schedule/attendance/ScheduleAttendancePage";
import { ScheduleManagePage } from "@/pages/project/schedule/manage/ScheduleManagePage";
import { ScheduleMyPage } from "@/pages/project/schedule/my/ScheduleMyPage";
import { ScheduleSettingsPage } from "@/pages/project/schedule/settings/ScheduleSettingsPage";

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
    // 輸出報表(規格第 11 章、18.4)
    { key: "reports", Page: ReportsPage },
    // 班表管理(規格 3.1):我的班表、排班設定是固定頁(頁內分頁)
    { key: "schedule.my", Page: ScheduleMyPage },
    { key: "schedule.settings", Page: ScheduleSettingsPage },
  ],
  forms: [
    // 排班作業(綁定 支援需求單)、出勤紀錄(綁定 補打卡申請):列表頁換成分頁頁殼,其餘三頁沿用表單引擎
    {
      moduleKey: "schedule.manage",
      pageOverrides: { list: { Page: ScheduleManagePage } },
    },
    {
      moduleKey: "schedule.attendance",
      pageOverrides: { list: { Page: ScheduleAttendancePage } },
    },
  ],
};
