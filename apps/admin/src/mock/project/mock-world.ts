import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { TestModule } from "@/test/msw/auth-handlers";
import { fieldsByCategory } from "@/test/msw/field-fixtures";
import {
  printButtonWorld,
  printingModule,
} from "@/test/msw/print-button-handlers";
import { dealersModules } from "@/test/msw/project/dealers-fixtures";
import { dealersWorld } from "@/test/msw/project/dealers-handlers";
import { fieldOptionColorWorld } from "@/test/msw/project/field-option-colors-handlers";
import { accountsModules } from "@/test/msw/project/lottery/accounts-fixtures";
import { accountsWorld } from "@/test/msw/project/lottery/accounts-handlers";
import { inventoryModules } from "@/test/msw/project/lottery/inventory-fixtures";
import { inventoryWorld } from "@/test/msw/project/lottery/inventory-handlers";
import { masterDataModules } from "@/test/msw/project/lottery/master-data-fixtures";
import { masterDataWorld } from "@/test/msw/project/lottery/master-data-handlers";
import {
  purchaseFormWorld,
  purchaseModules,
} from "@/test/msw/project/lottery/purchase-fixtures";
import { purchaseWorld } from "@/test/msw/project/lottery/purchase-handlers";
import { purchaseList } from "@/test/msw/project/lottery/purchasing-data-fixtures";
import {
  purchasingModules,
  requisitionFormWorld,
} from "@/test/msw/project/lottery/purchasing-fixtures";
import { purchasingWorld } from "@/test/msw/project/lottery/purchasing-handlers";
import { redemptionWorld } from "@/test/msw/project/lottery/redemption-handlers";
import { storeModules } from "@/test/msw/project/lottery/store-fixtures";
import { storeFormsWorld } from "@/test/msw/project/lottery/store-forms-fixtures";
import { storeWorld } from "@/test/msw/project/lottery/store-handlers";
import { storeSalesWorld } from "@/test/msw/project/lottery/store-sales-handlers";
import {
  transferFormWorld,
  transferModules,
} from "@/test/msw/project/lottery/transfer-fixtures";
import {
  transferWorld,
  withoutSettlementHandler,
} from "@/test/msw/project/lottery/transfer-handlers";
import { scheduleAttendanceWorld } from "@/test/msw/project/schedule-attendance-handlers";
import { scheduleCalendarWorld } from "@/test/msw/project/schedule-calendar-handlers";
import { scheduleDayOffsWorld } from "@/test/msw/project/schedule-day-offs-handlers";
import {
  makeupPunchFormWorld,
  makeupPunchWorkflowWorld,
} from "@/test/msw/project/schedule-makeup-punch-fixtures";
import { scheduleModules } from "@/test/msw/project/schedule-module-fixtures";
import { myChanges } from "@/test/msw/project/schedule-my-fixtures";
import {
  type ScheduleMyWorldOptions,
  scheduleMyWorld,
} from "@/test/msw/project/schedule-my-handlers";
import {
  type ScheduleRosterWorldOptions,
  scheduleRosterWorld,
} from "@/test/msw/project/schedule-roster-handlers";
import { scheduleSettingsWorld } from "@/test/msw/project/schedule-settings-handlers";
import {
  supportRequestFormWorld,
  supportRequestWorkflowWorld,
} from "@/test/msw/project/schedule-support-request-fixtures";

import type { ProjectMockWorld } from "../mock-world-source";

/** 欄位管理(客製替換頁)的選項顏色:示範分類三筆有顏色,其餘「不設定」。 */
const fieldOptionColors = () =>
  fieldOptionColorWorld({
    colorsByCategory: {
      "demo-category": [
        { fieldId: "f-staple", value: "staple", paletteKey: "green" },
        { fieldId: "f-side-dish", value: "side-dish", paletteKey: "yellow" },
        { fieldId: "f-fried", value: "fried", paletteKey: "orange" },
      ],
    },
    options: Object.fromEntries(
      Object.values(fieldsByCategory)
        .flat()
        .map((field) => [
          field.id,
          {
            categoryKey:
              field.categoryId === "cat-gender" ? "gender" : "demo-category",
            value: field.value,
          },
        ]),
    ),
  }).handlers;

/**
 * 排班表的檢核情境(看檢核面板與發布的三種確認視窗用):網址加 `?rosterCheck=reminders` / `clear`
 * 換檢核結果(預設 1 項限制 + 提醒),`?rosterPublished=1` 這個月一開始就已發布。
 * 自動排班:`?rosterAutoRun=ran` 一開始就有一次自動排班(檢核面板的摘要)、`running` 別人的自動排班執行中;
 * `?rosterEmpty=1` 這個月沒有人力需求(套用範本 / 自動排班的空狀態)。
 */
const rosterOptions = (): ScheduleRosterWorldOptions => {
  const params = new URLSearchParams(globalThis.location.search);
  const check = params.get("rosterCheck");
  return {
    ...(check === "reminders" || check === "clear" ? { check } : {}),
    isPublished: params.get("rosterPublished") === "1",
    hasAutoRun: params.get("rosterAutoRun") === "ran",
    autoRunning: params.get("rosterAutoRun") === "running",
    isEmpty: params.get("rosterEmpty") === "1",
  };
};

/** 我的班表:`?myBothDots=1` 在 11/4(缺下班卡)加一筆異動,看紅點與金點並排。 */
const myOptions = (): ScheduleMyWorldOptions => {
  const params = new URLSearchParams(globalThis.location.search);
  if (params.get("myBothDots") !== "1") {
    return {};
  }
  const changes = myChanges();
  return {
    changes: [
      ...changes,
      ...changes.slice(0, 1).map((change) => ({
        ...change,
        id: "change-1104",
        date: "2026-11-04",
      })),
    ],
  };
};

/** 輸出報表(seed `apps/db-migrator/seeds/project/reports.ts`;權限給滿)。 */
const reportsModule: TestModule = {
  id: "m-reports",
  key: "reports",
  name: "輸出報表",
  parentId: null,
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 50,
  route: "/reports",
  icon: "chart",
  permissions: ["reports.*"],
};

/**
 * 專案的 mock world:專案新增的模組在此登記 mock 模式的模組清單與假 api,底座更新不會動到這份。
 *
 * - `modules`:該視角側欄要多出的模組(與 seed 宣告一致,權限給滿才點得到每一頁)
 * - `handlers`:專案頁的假 api,夾具取自 `src/test/msw/project/`(與元件測試共用)
 */
/** 店面管理的看板 + 銷售(同一份看板狀態)。 */
const storeAndSalesHandlers = () => {
  const store = storeWorld();
  return [
    ...store.handlers,
    ...storeSalesWorld({ board: store.state }).handlers,
  ];
};

export const projectMockWorld: ProjectMockWorld = {
  // 檔案管理、經銷商管理:權限給滿(經銷商兩個批購基準日的欄位級權限也有),各分頁都看得到;輸出報表同樣給滿;
  // 班表管理(群組 + 四個子模組,權限給滿);帳戶管理、庫存管理(權限給滿)
  modules: () => [
    ...masterDataModules(),
    ...dealersModules(),
    reportsModule,
    ...scheduleModules(),
    ...accountsModules(),
    ...purchasingModules(),
    ...purchaseModules(),
    ...transferModules(),
    ...inventoryModules(),
    // 店面管理(表單模組,權限給滿)
    ...storeModules(),
    // 58mm 單據的 [列印] / [補印](`api.printing`;底座 mock 沒有給)
    printingModule(["api.printing.print", "api.printing.reprint"]),
  ],
  handlers: () => [
    ...fieldOptionColors(),
    ...masterDataWorld().handlers,
    ...dealersWorld().handlers,
    ...scheduleSettingsWorld().handlers,
    ...scheduleCalendarWorld().handlers,
    ...scheduleDayOffsWorld().handlers,
    // 我的班表 → 班表分頁:今天固定 2026-11-05(SC-01 的示範資料);`?myBothDots=1` 讓 11/4 同時缺卡又有異動
    ...scheduleMyWorld(myOptions()).handlers,
    // 調貨單:收付端點由這裡一個 handler 回(調貨單兩邊 + 其他單據照帳戶管理夾具),帳戶管理那一個拿掉
    ...transferWorld({ settlement: "all" }).handlers,
    ...withoutSettlementHandler(accountsWorld().handlers),
    ...scheduleRosterWorld(rosterOptions()).handlers,
    // 出勤紀錄:依分店(日)/ 依人員(月)的示範資料(SC-11 / SC-12)、改對應排班、補打卡的對應排班下拉
    ...scheduleAttendanceWorld().handlers,
    // 採購清單的分店換成底座 mock 組織樹上的兩個組織(分店名稱由組織樹解出)
    ...purchasingWorld({
      purchaseList: purchaseList({
        storeA: { id: "org-store" },
        storeB: { id: "org-content" },
      }),
    }).handlers,
    ...inventoryWorld().handlers,
    ...purchaseWorld().handlers,
    // 店面管理的看板:中山店三個收銀點(Figma ST-01;不管看哪家店都回這份);
    // 銷售、展開卡片、拆本、移櫃共用同一份看板狀態(售出後本班已售跟著變)
    ...storeAndSalesHandlers(),
    // 兌獎:[最近兌獎]、兌獎紀錄分頁、進貨單新增頁的兌獎區(Figma ST-38b / ST-40 / PU-05)
    ...redemptionWorld().handlers,
    // 店面管理的撤銷售出 / 現金更正分頁(Figma ST-31a / ST-32a 的列)與退款班次的選項
    ...storeFormsWorld().handlers,
    // 58mm 單據的 [列印]:可選的印表機(一台,可以試自動列印與補印)、已印次數、補印原因、建立工作;
    // 查工作沿用印表機管理那一個(每個操作只能有一個 handler)
    ...printButtonWorld().handlers.filter(
      ({ info }) => info.operationName !== "PrintJob",
    ),
  ],
  // 排班作業 → 支援需求單:表單、三筆提交與審核中那一筆的流程(併進底座的表單執行端 / 審核流程 world);
  // 叫貨、採購單 → 叫貨單:表單與五筆提交(草稿、審核中、待購買、已進貨、已調貨);
  // 進貨單:表單與四筆提交(草稿、審核中、已完成待退、已完成已結清);
  // 調貨單:表單與四筆提交(草稿、第一關出貨確認、第二關點收、已完成);
  // 出勤紀錄 → 補打卡申請:表單與兩筆審核中(一筆對應的排班已被刪除);
  // 店面管理:撤銷售出申請、現金更正單的定義(列表走專用查詢,沒有提交)
  formRuntime: () => {
    const support = supportRequestFormWorld();
    const makeup = makeupPunchFormWorld();
    const requisition = requisitionFormWorld();
    const purchase = purchaseFormWorld();
    const transfer = transferFormWorld();
    const store = storeFormsWorld().runtime;
    return {
      moduleForms: [
        ...(support.moduleForms ?? []),
        ...(makeup.moduleForms ?? []),
        ...(requisition.moduleForms ?? []),
        ...(purchase.moduleForms ?? []),
        ...(transfer.moduleForms ?? []),
        ...(store.moduleForms ?? []),
      ],
      versions: {
        ...support.versions,
        ...makeup.versions,
        ...requisition.versions,
        ...purchase.versions,
        ...transfer.versions,
        ...store.versions,
      },
      submissions: [
        ...(support.submissions ?? []),
        ...(makeup.submissions ?? []),
        ...(requisition.submissions ?? []),
        ...(purchase.submissions ?? []),
        ...(transfer.submissions ?? []),
      ],
      fieldOptions: { ...store.fieldOptions, ...support.fieldOptions },
      listColumns: {
        ...support.listColumns,
        ...requisition.listColumns,
        ...purchase.listColumns,
        ...transfer.listColumns,
      },
      listBuiltin: {
        ...support.listBuiltin,
        ...requisition.listBuiltin,
        ...purchase.listBuiltin,
        ...transfer.listBuiltin,
      },
    };
  },
  // 支援需求單、補打卡申請各自審核中的流程實例與待審任務
  workflowRuntime: () => {
    const support = supportRequestWorkflowWorld();
    const makeup = makeupPunchWorkflowWorld();
    return {
      instances: [...support.instances, ...makeup.instances],
      tasks: [...support.tasks, ...makeup.tasks],
    };
  },
};
