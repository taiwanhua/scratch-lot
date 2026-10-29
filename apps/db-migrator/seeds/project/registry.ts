import { LOTTERY_PORTABLE_LOOKUP_PROVIDERS } from "@repo/domain/project/lottery";
import type { SeedSet } from "@repo/domain/seed";

import type { DemoSource } from "../../src/demo/demo-source";
import type { SeedSource } from "../base/seed-source";
import { accountsModule } from "./accounts";
import { dealersModule } from "./dealers";
import { lotteryDemoSource } from "./demo";
import { projectFieldCategories, projectFields } from "./field-categories";
import { inventoryModule } from "./inventory";
import { masterDataModule } from "./master-data";
import { purchasingModuleDeclarations } from "./purchasing";
import { purchasingPurchaseModule } from "./purchasing.purchase";
import { purchasingTransferModule } from "./purchasing.transfer";
import { reportsModule } from "./reports";
import { seed as cashCorrectionForm } from "./revisions/cash_correction.r2.seed";
import { seed as checkoutConfirmForm } from "./revisions/checkout_confirm.r2.seed";
import { seed as makeupPunchForm } from "./revisions/makeup_punch.r4.seed";
import { seed as purchaseForm } from "./revisions/purchase.r5.seed";
import { seed as requisitionForm } from "./revisions/requisition.r4.seed";
import { seed as saleReversalForm } from "./revisions/sale_reversal.r3.seed";
import { seed as stocktakeConfirmForm } from "./revisions/stocktake_confirm.r3.seed";
import { seed as supportRequestForm } from "./revisions/support_request.r4.seed";
import { seed as transferForm } from "./revisions/transfer.r3.seed";
import { scheduleModuleDeclarations } from "./schedule";
import { storeModule } from "./store";

/**
 * 專案的種子來源(正本:ADR-0002)。專案新增的內容登記在這裡,不改 `seeds/base/`:
 *
 * - `moduleDeclarations`:專案模組(宣告方式與 helper 同底座,見 `../base/module-declaration.ts`、
 *   `../base/form-module-declaration.ts`;子模組可以掛在底座的父節點底下)。modules / permissions /
 *   資料範圍目標 / 租戶管理員模板由組裝入口推導,不要另外用 documents 宣告
 * - `seeds`:專案的普通種子(每類一檔,放本目錄)與明確登記的共用表單 / 流程定義
 *   (設計器匯出的 `.seed.ts` 放 `./revisions/`,在此 import 它的 `seed`)
 *
 * 與底座撞 key 不會靜默覆蓋:組裝時直接拒絕。
 */
export const projectSeedSource: SeedSource = {
  moduleDeclarations: [
    // 檔案管理(專案規格 5.1、5.5)
    masterDataModule,
    // 經銷商管理(專案規格 5.2–5.4)
    dealersModule,
    // 輸出報表(規格 3.1、3.2、第 11 章)
    reportsModule,
    // 班表管理群組與四個子模組(規格 3.1、3.2)
    ...scheduleModuleDeclarations,
    // 帳戶管理(專案規格第 9 章、第 10 章)
    accountsModule,
    // 叫貨與進貨群組 + 叫貨、採購單(規格 3.1、3.2、8.1)
    ...purchasingModuleDeclarations,
    // 叫貨與進貨 → 進貨單(規格 3.1、3.2、8.2)
    purchasingPurchaseModule,
    // 叫貨與進貨 → 調貨單(規格 3.1、3.2、8.4)
    purchasingTransferModule,
    // 庫存管理(專案規格第 7 章)
    inventoryModule,
    // 店面管理(規格 3.1、3.2、第 6 章;表單模組、開啟 B9b)
    storeModule,
  ],
  // 受管表單引用的專案 lookup 來源(與 api 的 lookup 登記讀同一份;叫貨單、進貨單的明細引用遊戲,
  // 進貨單的單頭引用甲類、受託人、銀行帳戶、兌獎區引用兌獎紀錄;調貨單的明細引用本;
  // 撤銷售出申請 / 現金更正單引用本與收銀班次)
  portableLookupProviders: LOTTERY_PORTABLE_LOOKUP_PROVIDERS,
  seeds: [
    // 欄位管理的專案系統類別與全域選項(專案規格第 13 章)
    projectFieldCategories,
    projectFields,
    // 排班作業的受管表單:支援需求單(規格 14.10;流程不 seed,由開通腳本依租戶角色建)。
    // 結束欄的 custom 公式是 `and` 兩種形狀的聯集,型別收窄理由同下面的進貨單
    supportRequestForm as SeedSet,
    // 出勤紀錄的受管表單:補打卡申請(規格 14.8;流程不 seed,由開通腳本依租戶角色建)
    makeupPunchForm,
    // 叫貨、採購單的受管表單:叫貨單(規格 8.1;流程不 seed,由開通腳本依租戶角色建)
    requisitionForm,
    // 叫貨與進貨 → 進貨單的受管表單(規格 8.2;流程不 seed,由開通腳本依租戶角色建)。
    // 快照的推論型別把不同形狀的公式合成聯集(`{ var } | { sumOf }` 各帶對方的 `?: undefined`),
    // 在 exactOptionalPropertyTypes 下不能直接當 `SeedSet`;快照本身已 `satisfies SeedSet`,這裡只收窄型別
    purchaseForm as SeedSet,
    // 叫貨與進貨 → 調貨單的受管表單(規格 8.4;流程不 seed,由開通腳本依租戶角色建)
    transferForm,
    // 店面管理的受管表單:撤銷售出申請、現金更正單(規格 8.5、8.8;流程不 seed,由開通腳本依租戶角色建)
    saleReversalForm,
    cashCorrectionForm,
    // 店面管理的受管表單:盤點確認申請(規格 8.6;流程不 seed,由開通腳本依租戶角色建)
    stocktakeConfirmForm,
    // 店面管理的受管表單:結帳確認申請(規格 8.7;交班與日結同一張;流程不 seed,由開通腳本依租戶角色建)
    checkoutConfirmForm,
  ],
};

/**
 * 專案的示範資料(demo 指令用;不進一般 seed,ADR-0002)。內容在 `./demo/`,
 * 由 `seeds/registry.ts` 轉給底座的 demo 指令(`docs/deployment.md`「示範資料(demo)」)。
 */
export const projectDemoSource: DemoSource | null = lotteryDemoSource;
