import {
  formModulePageKeys,
  formModulePages,
} from "@/components/base/form-engine/FormModulePages/form-module-pages";
import { withTenantRequired } from "@/components/project/RootOrgNotice/WithTenantRequired";
import { AccountsPage } from "@/pages/project/lottery/accounts/AccountsPage/AccountsPage";
import { BankAccountViewPage } from "@/pages/project/lottery/accounts/BankAccountViewPage/BankAccountViewPage";
import { ACCOUNTS_MODULE_KEYS } from "@/pages/project/lottery/accounts/accounts-config";
import { ContactFormPage } from "@/pages/project/lottery/dealers/ContactFormPage/ContactFormPage";
import { ContactViewPage } from "@/pages/project/lottery/dealers/ContactViewPage/ContactViewPage";
import { DealerFormPage } from "@/pages/project/lottery/dealers/DealerFormPage/DealerFormPage";
import { DealerViewPage } from "@/pages/project/lottery/dealers/DealerViewPage/DealerViewPage";
import { DealersPage } from "@/pages/project/lottery/dealers/DealersPage/DealersPage";
import { DEALERS_MODULE_KEYS } from "@/pages/project/lottery/dealers/dealers-keys";
import { BookPage } from "@/pages/project/lottery/inventory/BookPage/BookPage";
import { InventoryPage } from "@/pages/project/lottery/inventory/InventoryPage/InventoryPage";
import { INVENTORY_MODULE_KEYS } from "@/pages/project/lottery/inventory/inventory-config";
import { GameFormPage } from "@/pages/project/lottery/master-data/GameFormPage/GameFormPage";
import { GameViewPage } from "@/pages/project/lottery/master-data/GameViewPage/GameViewPage";
import { MasterDataPage } from "@/pages/project/lottery/master-data/MasterDataPage/MasterDataPage";
import { MASTER_DATA_MODULE_KEYS } from "@/pages/project/lottery/master-data/master-data-config";
import { RequisitionCreatePage } from "@/pages/project/lottery/purchasing/RequisitionCreatePage/RequisitionCreatePage";
import { RequisitionPage } from "@/pages/project/lottery/purchasing/RequisitionPage/RequisitionPage";
import { PurchaseCreatePage } from "@/pages/project/lottery/purchasing/purchase/PurchaseCreatePage/PurchaseCreatePage";
import { PurchasePage } from "@/pages/project/lottery/purchasing/purchase/PurchasePage/PurchasePage";
import { PurchaseViewPage } from "@/pages/project/lottery/purchasing/purchase/PurchaseViewPage/PurchaseViewPage";
import { TransferCreatePage } from "@/pages/project/lottery/purchasing/transfer/TransferCreatePage/TransferCreatePage";
import { TransferPage } from "@/pages/project/lottery/purchasing/transfer/TransferPage/TransferPage";
import { TransferViewPage } from "@/pages/project/lottery/purchasing/transfer/TransferViewPage/TransferViewPage";
import { ReportsPage } from "@/pages/project/lottery/reports/ReportsPage/ReportsPage";
import { StorePage } from "@/pages/project/lottery/store/StorePage/StorePage";
import { StoreCreatePage } from "@/pages/project/lottery/store/forms/StoreCreatePage/StoreCreatePage";
import {
  StoreEditPage,
  StoreViewPage,
} from "@/pages/project/lottery/store/forms/StoreSubmissionPages/StoreSubmissionPages";
import { MakeupPunchFormPage } from "@/pages/project/schedule/attendance/MakeupPunchFormPage/MakeupPunchFormPage";
import { MakeupPunchViewPage } from "@/pages/project/schedule/attendance/MakeupPunchViewPage/MakeupPunchViewPage";
import { ScheduleAttendancePage } from "@/pages/project/schedule/attendance/ScheduleAttendancePage";
import { ScheduleManagePage } from "@/pages/project/schedule/manage/ScheduleManagePage";
import { ScheduleMyPage } from "@/pages/project/schedule/my/ScheduleMyPage";
import { ScheduleSettingsPage } from "@/pages/project/schedule/settings/ScheduleSettingsPage";

import type {
  FormPageSlot,
  ModulePageSource,
  PagePresentation,
} from "../module-page-registry";

/**
 * 專案的模組頁面來源:專案自己新增的模組在此登記(頁面放 `pages/project/`),底座更新不會動到這份。
 *
 * - 固定頁寫進 `pages`;表單模組寫進 `forms`(四頁用表單引擎的預設組裝,單頁客製用 `pageOverrides`)
 * - key 不可與底座或彼此相撞;要換掉底座的頁不是在這裡撞 key,而是寫進 `page-replacements.ts`
 * - 登記不等於授權:進不進得去仍看 `me.modules`
 * - 每一頁(含表單模組沒換掉、沿用表單引擎的那幾頁)都套 `withTenantRequired`:站在根組織(平台層級)
 *   只顯示「請先切換到要管理的機構」,不發任何專案查詢(`gateTenant`)
 */
const sources: ModulePageSource = {
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
    // 帳戶管理(規格第 9 章、10.1–10.3):分頁頁 + 銀行帳戶詳情
    { key: ACCOUNTS_MODULE_KEYS.list, Page: AccountsPage },
    {
      key: ACCOUNTS_MODULE_KEYS.bankAccountViewPage,
      Page: BankAccountViewPage,
    },
    // 庫存管理(規格 7.3、7.4、7.6):分頁頁 + 本的詳情
    { key: INVENTORY_MODULE_KEYS.list, Page: InventoryPage },
    { key: INVENTORY_MODULE_KEYS.bookPage, Page: BookPage },
  ],
  forms: [
    // 排班作業(綁定 支援需求單)、出勤紀錄(綁定 補打卡申請):列表頁換成分頁頁殼,其餘三頁沿用表單引擎
    {
      moduleKey: "schedule.manage",
      pageOverrides: { list: { Page: ScheduleManagePage } },
    },
    // 出勤紀錄(綁定 補打卡申請;規格 14.7、14.8):列表頁換成分頁頁殼(依人員(月)| 依分店(日));
    // 新增 / 編輯頁換成有「對應排班」下拉的補打卡頁、檢視頁換成摘要 + 審核(排班被刪除時警告、不能核准)
    {
      moduleKey: "schedule.attendance",
      pageOverrides: {
        list: { Page: ScheduleAttendancePage },
        createPage: { Page: MakeupPunchFormPage },
        editPage: { Page: MakeupPunchFormPage },
        viewPage: { Page: MakeupPunchViewPage },
      },
    },
    // 叫貨、採購單(綁定 叫貨單;規格 8.1):列表頁換成分頁頁殼(叫貨單 | 採購清單)、新增頁換成
    // 列出所有販售中遊戲的叫貨頁;詳情 / 編輯(草稿)沿用表單引擎
    {
      moduleKey: "purchasing.requisition",
      pageOverrides: {
        list: { Page: RequisitionPage },
        createPage: { Page: RequisitionCreatePage },
      },
    },
    // 進貨單(綁定 進貨單;規格 8.2):列表加點收進度與結算、新增頁換成刷條碼頁、檢視頁換成
    // 引擎零件 + 點收區塊 + 結算 + 審核;編輯(草稿、被退回)沿用表單引擎
    {
      moduleKey: "purchasing.purchase",
      pageOverrides: {
        list: { Page: PurchasePage },
        createPage: { Page: PurchaseCreatePage },
        viewPage: { Page: PurchaseViewPage },
      },
    },
    // 調貨單(綁定 調貨單;規格 8.4):列表加本數 / 張數、點收進度、結算與「在途」、新增頁換成選本 + 張數格子、
    // 檢視頁換成出貨確認清單 / 點收區塊 + 結算 + 審核;編輯(草稿、被退回)沿用表單引擎
    {
      moduleKey: "purchasing.transfer",
      pageOverrides: {
        list: { Page: TransferPage },
        createPage: { Page: TransferCreatePage },
        viewPage: { Page: TransferViewPage },
      },
    },
    // 店面管理(表單模組、開啟 B9b;規格 6.1):列表頁換成分頁頁殼(看板 | … | 其他申請);
    // 新增頁:撤銷售出申請換成替換新增頁(ST-31b),其他表單沿用表單引擎;詳情 / 編輯沿用表單引擎
    {
      moduleKey: "store",
      pageOverrides: {
        list: { Page: StorePage },
        createPage: { Page: StoreCreatePage },
        // 盤點確認申請的檢視頁(盤點單明細 + 審核)與退回後的編輯頁(盤點頁帶入原內容);其他表單沿用表單引擎
        viewPage: { Page: StoreViewPage },
        editPage: { Page: StoreEditPage },
      },
    },
  ],
};

const FORM_SLOTS: readonly FormPageSlot[] = [
  "list",
  "viewPage",
  "createPage",
  "editPage",
];

/** 所有專案頁套上根組織守門;表單模組四頁都套(沒換掉的用表單引擎的預設頁)。 */
const gateTenant = (source: ModulePageSource): ModulePageSource => ({
  pages: source.pages.map((entry) => ({
    ...entry,
    Page: withTenantRequired(entry.Page),
  })),
  forms: source.forms.map((entry) => {
    const defaults = formModulePages(entry.moduleKey);
    const keys = formModulePageKeys(entry.moduleKey);
    const pageOverrides: Partial<Record<FormPageSlot, PagePresentation>> = {};
    for (const slot of FORM_SLOTS) {
      const own = entry.pageOverrides?.[slot];
      const Page = own?.Page ?? defaults[keys[slot]];
      pageOverrides[slot] = { ...own, Page: withTenantRequired(Page) };
    }
    return { ...entry, pageOverrides };
  }),
});

export const projectModulePages: ModulePageSource = gateTenant(sources);
