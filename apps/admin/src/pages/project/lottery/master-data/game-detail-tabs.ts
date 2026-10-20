import type { ComponentType } from "react";

import type { LotteryGameFieldsFragment } from "@repo/graphql";

import { GameBasicTab } from "./GameViewPage/GameBasicTab";

/** 詳情頁分頁內容拿得到的東西。 */
export interface GameDetailTabProps {
  game: LotteryGameFieldsFragment;
}

/** 遊戲詳情頁的一個分頁。 */
export interface GameDetailTab {
  /** 網址 `?tab=` 的值 */
  value: string;
  /** i18n key(`admin.lotteryMasterData.gameView.tabs.<labelKey>`)或各票自己的 namespace 完整 key */
  labelKey: string;
  /** 看得到這個分頁要的權限(`hasPermission`);不給 = 看得到詳情頁就看得到 */
  permission?: string;
  Content: ComponentType<GameDetailTabProps>;
}

/**
 * 遊戲詳情頁的分頁登記(規格 5.1:庫存概況、預計要給本數)。本票(P04)只有「基本資料」;
 * 「庫存概況」「預計要給本數」(權限 `inventory.edit-allocations`)由 P20 **只追加**一列。
 */
export const GAME_DETAIL_TABS: readonly GameDetailTab[] = [
  { value: "basic", labelKey: "basic", Content: GameBasicTab },
];
