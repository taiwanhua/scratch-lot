import type { ComponentType } from "react";

import { WHOLESALE_PERMISSIONS } from "@repo/domain/project/lottery";
import type { LotteryWholesaleCustomerFieldsFragment } from "@repo/graphql";

import { CustomerWholesalesTab } from "@/pages/project/lottery/purchasing/wholesale/CustomerWholesalesTab";

export interface WholesaleCustomerDetailTabProps {
  customer: LotteryWholesaleCustomerFieldsFragment;
}

/** 批售客戶詳情頁「基本資料」之後的一個分頁。 */
export interface WholesaleCustomerDetailTab {
  /** 網址上的值(`?tab=`) */
  value: string;
  /** 分頁名稱的文案 key(`admin.lotteryDealers` 底下) */
  labelKey: string;
  /** 看得到這個分頁要持有的權限 */
  permission: string;
  Content: ComponentType<WholesaleCustomerDetailTabProps>;
}

/**
 * 批售客戶詳情頁的分頁登記(規格 21.2:基本資料 | 批售紀錄;做法同 `DealerViewPage/dealer-detail-tabs.ts`)。
 * 「批售紀錄」由批售單的功能在這裡追加一列(要 `purchasing.wholesale.view`),內容放它自己的資料夾。
 * 只有「基本資料」時不顯示分頁籤。
 */
export const WHOLESALE_CUSTOMER_DETAIL_TABS: readonly WholesaleCustomerDetailTab[] =
  [
    // 批售紀錄(規格 21.2;要 `purchasing.wholesale.view`)
    {
      value: "wholesales",
      labelKey: "wholesale.sections.documents",
      permission: WHOLESALE_PERMISSIONS.view,
      Content: CustomerWholesalesTab,
    },
  ];
