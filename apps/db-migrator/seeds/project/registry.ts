import type { DemoSource } from "../../src/demo/demo-source";
import type { SeedSource } from "../base/seed-source";
import { dealersModule } from "./dealers";
import { lotteryDemoSource } from "./demo";
import {
  projectFieldCategories,
  projectFieldOptionColors,
  projectFields,
} from "./field-categories";
import { masterDataModule } from "./master-data";
import { reportsModule } from "./reports";
import { seed as supportRequestForm } from "./revisions/support_request.r1.seed";
import { scheduleModuleDeclarations } from "./schedule";

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
  ],
  seeds: [
    // 欄位管理的專案系統類別與全域選項(專案規格第 13 章)
    projectFieldCategories,
    projectFields,
    // 全域選項的初始顏色(目前只有崗位;規格 18.5)
    projectFieldOptionColors,
    // 排班作業的受管表單:支援需求單(規格 14.10;流程不 seed,由開通腳本依租戶角色建)
    supportRequestForm,
  ],
};

/**
 * 專案的示範資料(demo 指令用;不進一般 seed,ADR-0002)。內容在 `./demo/`,
 * 由 `seeds/registry.ts` 轉給底座的 demo 指令(`docs/deployment.md`「示範資料(demo)」)。
 */
export const projectDemoSource: DemoSource | null = lotteryDemoSource;
