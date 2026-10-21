import type { ComponentType } from "react";

import { STORE_PERMISSIONS, STORE_TABS } from "@repo/domain/project/lottery";

import type { ModulePageProps } from "@/lib/base/module-tree";

import { BoardTab } from "./BoardTab/BoardTab";
import { OtherFormsTab } from "./OtherFormsTab/OtherFormsTab";
import { RedemptionsTab } from "./redemption/RedemptionsTab";

/** 店面管理的一個分頁。 */
export interface StoreTabEntry {
  /** 網址 `?tab=` 的值(`STORE_TABS`) */
  value: string;
  /** 分頁籤文字的 i18n key(`admin.lotteryStore.tabs.<labelKey>`) */
  labelKey: string;
  /** 看得到這個分頁要的權限;不給 = 看得到這一頁的人都看得到 */
  permission?: string;
  /** 分頁內容(拿得到模組,表單引擎的列表要用) */
  Content: ComponentType<ModulePageProps>;
}

/**
 * 店面管理(`store`,表單模組)的分頁(規格 6.1:看板 | 班次結帳歷史紀錄 | 盤點紀錄 | 撤銷售出 | 現金更正 |
 * 兌獎紀錄 | 其他申請,依權限顯示)。各功能只追加自己那一列,依規格的順序插入(Spec #104 第 3 節第 10 批)。
 */
export const STORE_TAB_ENTRIES: readonly StoreTabEntry[] = [
  // 看板(規格 6.1、6.2):`store.view`(api `lotteryStoreBoard` 也守它)
  {
    value: STORE_TABS.board,
    labelKey: "board",
    permission: STORE_PERMISSIONS.view,
    Content: BoardTab,
  },
  // 兌獎紀錄(規格 6.5;ST-40):`store.view`(api `lotteryRedemptions` 也守它)
  {
    value: STORE_TABS.redemptions,
    labelKey: "redemptions",
    permission: STORE_PERMISSIONS.view,
    Content: RedemptionsTab,
  },
  // 其他申請:租戶自己綁到本模組的表單,用表單引擎的預設列表
  {
    value: STORE_TABS.otherForms,
    labelKey: "otherForms",
    Content: OtherFormsTab,
  },
];
