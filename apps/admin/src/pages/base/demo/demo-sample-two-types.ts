import type { DemoItemTwoQuery, DemoItemsTwoQuery } from "@repo/graphql";

import type { ShareOrgValue } from "@/components/base/ShareOrgsField/ShareOrgsField";

/** 列表的一列(`demoItemsTwo.items[]`)。 */
export type DemoItemTwoRow = DemoItemsTwoQuery["demoItemsTwo"]["items"][number];

/** 單筆(詳情頁與編輯頁共用同一個 fragment,所以兩頁看到的形狀一致)。 */
export type DemoItemTwoDetail = DemoItemTwoQuery["demoItemTwo"]["item"];

/**
 * 表單的欄位。對照組只有名稱、備註與「共用給」—— 沒有分類、沒有狀態、沒有內部備註、沒有檔案。
 * `enabled` 不在表單上:它由 `setDemoItemTwoEnabled` 單獨切換(模組文件「api 介面」)。
 */
export interface SampleTwoFormValues {
  name: string;
  note: string;
  /** 共用給(資料共用,ADR-0014);要有 `.edit` 才出現在表單上 */
  shareOrgs: ShareOrgValue[];
}
