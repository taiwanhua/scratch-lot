import type { ComponentType } from "react";

import {
  type LotteryDealerFieldsFragment,
  LotteryDealerType,
} from "@repo/graphql";

import {
  DealerAllocationsTab,
  DealerStockTab,
} from "@/components/project/lottery/InventoryDetailTabs/InventoryDetailTabs";

import { CoSellersTab } from "./CoSellersTab";
import { SigninsTab } from "./SigninsTab";

/** 詳情頁分頁的內容元件收到的那一位經銷商。 */
export interface DealerDetailTabProps {
  dealer: LotteryDealerFieldsFragment;
}

/** 經銷商詳情頁的一個分頁。 */
export interface DealerDetailTab {
  /** 網址上的值(`?tab=`) */
  value: string;
  /** 分頁名稱的文案 key(`admin.lotteryDealers` 底下) */
  labelKey: string;
  /** 哪一類的詳情頁有這個分頁 */
  types: readonly LotteryDealerType[];
  Content: ComponentType<DealerDetailTabProps>;
}

/**
 * 經銷商詳情頁的分頁登記(規格 5.2:甲類 = 批購紀錄、見簽紀錄;乙類 = 共同銷售人、預計要給本數、在店庫存)。
 *
 * 追加方式:批購紀錄(進貨單)、預計要給本數與在店庫存(庫存管理)由各自的功能在這裡**追加一列**
 * (順序照規格),分頁內容放各自的資料夾;不改別人的那一列。文案放 `admin.lotteryDealers` 底下自己的子物件。
 */
export const DEALER_DETAIL_TABS: readonly DealerDetailTab[] = [
  {
    value: "signins",
    labelKey: "signins.tab",
    types: [LotteryDealerType.A],
    Content: SigninsTab,
  },
  {
    value: "co-sellers",
    labelKey: "coSellers.tab",
    types: [LotteryDealerType.B],
    Content: CoSellersTab,
  },
  // 庫存管理(P20):對應分店的預計要給本數、在店庫存
  {
    value: "allocations",
    labelKey: "allocations.tab",
    types: [LotteryDealerType.B],
    Content: DealerAllocationsTab,
  },
  {
    value: "stock",
    labelKey: "stock.tab",
    types: [LotteryDealerType.B],
    Content: DealerStockTab,
  },
];
