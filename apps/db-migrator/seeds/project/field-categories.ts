import { LOTTERY_FIELD_CATEGORY_KEYS as LOTTERY } from "@repo/domain/project/lottery-fields";
import {
  REASON_OTHER_VALUE,
  SHARED_FIELD_CATEGORY_KEYS as SHARED,
} from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS as SCHEDULE } from "@repo/domain/project/schedule-fields";

import {
  type SeedDocument,
  type SeedDocumentSet,
  seedRef,
} from "../../src/seed/seed-declaration";
import {
  FIELD_INITIAL_SEED_VALUE_FIELDS,
  type SeedFieldOption as FieldOption,
  globalFieldOptions,
} from "../base/fields";
import { ROOT_ORG_KEY } from "../base/orgs";

/** 一個專案系統類別與它的全域預設選項(order 依宣告順序 1 起算)。 */
export interface ProjectFieldCategory {
  key: string;
  name: string;
  /** 用在哪裡(寫進類別說明) */
  usedIn: string;
  options: readonly FieldOption[];
}

const other: FieldOption = { value: REASON_OTHER_VALUE, label: "其他" };

/**
 * 專案的欄位管理系統類別(專案規格第 13 章;內容正本:`docs/modules/project/field-manager.md`)。
 * 類別 key 與程式要認得的選項代碼在 `@repo/domain/project/{lottery,schedule}-fields`;
 * 選項 value 一律英文 kebab-case,「其他」一律 `other`(選它時說明必填,`requiresReasonNote`)。
 * 選項可宣告初始顏色 `color`(底座 `fields.color` 的初始 seed 值;目前都沒有,崗位不內建,由各機構開通時自建)。
 */
export const PROJECT_FIELD_CATEGORIES: readonly ProjectFieldCategory[] = [
  {
    key: LOTTERY.saleReversalReason,
    name: "撤銷售出原因",
    usedIn: "撤銷售出申請",
    options: [
      { value: "customer-return", label: "客人退貨" },
      { value: "wrong-ticket", label: "刷錯刮刮樂" },
      { value: "stocktake-error", label: "盤點錯誤" },
      other,
    ],
  },
  {
    key: LOTTERY.redemptionRevokeReason,
    name: "撤銷兌獎原因",
    usedIn: "撤銷兌獎(已結帳或別人登記)",
    options: [
      { value: "entry-error", label: "登記錯誤" },
      { value: "wrong-amount", label: "金額錯誤" },
      other,
    ],
  },
  {
    key: LOTTERY.manualSaleReason,
    name: "手動標記原因",
    usedIn: "手動標記售出(預設「刷不到條碼」)",
    options: [
      { value: "scan-failed", label: "刷不到條碼" },
      { value: "system-backfill", label: "系統異常補登" },
      other,
    ],
  },
  {
    key: LOTTERY.cashCorrectionReason,
    name: "現金更正原因",
    usedIn: "現金更正單",
    options: [
      { value: "staff-compensation", label: "員工賠補" },
      { value: "customer-top-up", label: "客人補付" },
      { value: "recovered", label: "尋回" },
      { value: "customer-refund", label: "退還客人" },
      { value: "lost", label: "遺失" },
      { value: "counterfeit", label: "假鈔" },
      { value: "deposit-shortage", label: "存款短少" },
      other,
    ],
  },
  {
    // 刮刮樂與排班共用(叫貨單、進貨單、調貨單、補打卡申請的作廢原因)
    key: SHARED.voidReason,
    name: "作廢原因",
    usedIn: "所有單據作廢",
    options: [
      { value: "input-error", label: "輸入錯誤" },
      { value: "duplicate", label: "重複建立" },
      { value: "transaction-cancelled", label: "交易取消" },
      other,
    ],
  },
  {
    key: LOTTERY.checkoutDiffReason,
    name: "結帳差額原因",
    usedIn: "結帳精靈、日結",
    options: [
      { value: "wrong-change", label: "找錯錢" },
      { value: "redemption-overpaid", label: "兌獎誤付" },
      { value: "pending-documents", label: "審核中的單據" },
      other,
    ],
  },
  {
    key: LOTTERY.skipStocktakeReason,
    name: "跳過盤點原因",
    usedIn: "結帳精靈、日結",
    options: [
      { value: "short-staffed", label: "人力不足" },
      { value: "system-error", label: "系統異常" },
      other,
    ],
  },
  {
    key: LOTTERY.withdrawReason,
    name: "出庫原因",
    usedIn: "出庫",
    options: [
      { value: "opening-float", label: "開班零用金" },
      { value: "change-refill", label: "補零錢" },
      other,
    ],
  },
  {
    key: LOTTERY.lostReason,
    name: "遺失原因",
    usedIn: "確認遺失",
    options: [
      { value: "lost-in-transfer", label: "調貨途中遺失" },
      { value: "lost-in-store", label: "店內遺失" },
      { value: "unknown", label: "原因不明" },
      other,
    ],
  },
  {
    key: LOTTERY.recoverReason,
    name: "尋回原因",
    usedIn: "尋回",
    options: [
      { value: "found-in-stocktake", label: "盤點找到" },
      { value: "transfer-misdelivered", label: "調貨送錯" },
      other,
    ],
  },
  {
    key: LOTTERY.scrapReason,
    name: "報廢原因",
    usedIn: "報廢",
    options: [
      { value: "damaged", label: "破損" },
      { value: "soiled", label: "污損" },
      other,
    ],
  },
  {
    key: SCHEDULE.position,
    name: "崗位",
    usedIn:
      "人力需求、人力需求範本、收銀點、支援需求單(同一家店崗位和收銀點 1:1)",
    // 不內建崗位:各機構開通時自己建(開通清單第 5 點)
    options: [],
  },
  {
    key: SCHEDULE.task,
    name: "執行任務",
    usedIn: "人力需求的每筆執行任務",
    options: [
      { value: "store-and-accounts-lead", label: "店內事務與帳目負責" },
      { value: "store-duties", label: "店內事務" },
    ],
  },
  {
    key: SCHEDULE.changeReason,
    name: "排班異動原因",
    usedIn: "發布後排班異動",
    options: [
      { value: "emergency-leave", label: "臨時請假" },
      { value: "shift-swap", label: "換班" },
      { value: "sick-leave", label: "病假" },
      other,
    ],
  },
  {
    key: SCHEDULE.makeupPunchReason,
    name: "補打卡原因",
    usedIn: "補打卡申請",
    options: [
      { value: "forgot-punch", label: "忘記打卡" },
      { value: "device-failure", label: "裝置故障" },
      other,
    ],
  },
  {
    key: SCHEDULE.dayOffOverrideReason,
    name: "代改畫休原因",
    usedIn: "畫休截止後店長代改畫休",
    options: [
      { value: "staff-late-notice", label: "員工臨時告知" },
      { value: "entry-error", label: "登記錯誤" },
      { value: "store-adjustment", label: "店務調整" },
      other,
    ],
  },
  {
    key: SCHEDULE.entryReassignReason,
    name: "改對應排班原因",
    usedIn: "打卡或收銀班次改對應排班",
    options: [
      { value: "wrong-entry-at-open", label: "開班時選錯排班" },
      { value: "cover-shift-reassign", label: "臨時代班補排班後改對應" },
      { value: "shift-swap", label: "換班" },
      other,
    ],
  },
  {
    key: LOTTERY.skipCorrectionReason,
    name: "更正跳號原因",
    usedIn: "更正已標註的跳號",
    options: [
      { value: "mark-error", label: "標註錯誤" },
      { value: "misread-number", label: "張號看錯" },
      other,
    ],
  },
  {
    key: SCHEDULE.specialDayCategory,
    name: "特殊日類別",
    usedIn: "行事曆",
    options: [
      { value: "national-holiday", label: "國定假日" },
      { value: "typhoon-day", label: "颱風假" },
      { value: "event-day", label: "活動日" },
      other,
    ],
  },
];

/** 類別說明:用在哪裡;有「其他」的類別補一句說明必填。 */
function descriptionOf(category: ProjectFieldCategory): string {
  const hasOther = category.options.some(
    (option) => option.value === REASON_OTHER_VALUE,
  );
  return hasOther
    ? `用在:${category.usedIn};選「其他」時說明必填`
    : `用在:${category.usedIn}`;
}

/** 欄位類別:形狀同 `seeds/base/field-categories.ts`(名稱 / 說明每次 seed,`enabled` 是初始 seed 值)。 */
export const projectFieldCategories: SeedDocumentSet = {
  kind: "documents",
  collection: "field_categories",
  entries: PROJECT_FIELD_CATEGORIES.map((category): SeedDocument => ({
    key: category.key,
    data: {
      name: category.name,
      description: descriptionOf(category),
      enabled: true,
    },
  })),
};

/**
 * 全域欄位選項:形狀、初始值欄位與認養條件同 `seeds/base/fields.ts`(同一個 collection 的政策必須一致,組裝時驗)。
 * key = `<類別 key>.<value>`;categoryId 於執行時由類別 key 解析。
 */
export const projectFields: SeedDocumentSet = {
  kind: "documents",
  collection: "fields",
  initialSeedValueFields: [...FIELD_INITIAL_SEED_VALUE_FIELDS],
  adoptBy: {
    fields: ["categoryId", "value"],
    where: { isSystem: false, orgId: seedRef("orgs", ROOT_ORG_KEY) },
  },
  entries: PROJECT_FIELD_CATEGORIES.flatMap((category) =>
    globalFieldOptions(category.key, category.options),
  ),
};
