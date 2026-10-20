import { createContext, useContext } from "react";

import type { ScheduleCheckQuery } from "@repo/graphql";

import type { RosterCellTarget, RosterData } from "../roster-context";

export type RosterCheckResult = ScheduleCheckQuery["scheduleCheck"];
export type RosterCheckItem = RosterCheckResult["items"][number];

/**
 * 檢核面板與發布共用的東西(規格 14.5「檢核面板」「發布」):頁殼的資料、檢核結果、面板開關、捲到格子。
 * 由 `RosterCheckProvider` 包住整個排班表頁(工具列的檢核按鈕、[發布] 也在裡面,所以不放進 `RosterContext`)。
 */
export interface RosterCheckContextValue {
  /** 排班表資料(還在載入 = undefined) */
  data: RosterData | undefined;
  month: string;
  /** 用最新生效設定的檢核結果(還在載入 = undefined) */
  check: RosterCheckResult | undefined;
  isChecking: boolean;
  isCheckError: boolean;
  /** 檢核面板開著(電腦 / 平板是右側面板、手機是底部面板) */
  isOpen: boolean;
  /** 打開 / 關上面板(自動排班完成後由自動排班的功能打開) */
  setOpen: (open: boolean) => void;
  /** 打開發布確認視窗([發布]) */
  openPublish: () => void;
  /** 捲到那一格並閃爍(`RosterPage` 的 `scrollToCell`) */
  scrollToCell: (target: RosterCellTarget) => void;
}

export const RosterCheckContext = createContext<RosterCheckContextValue | null>(
  null,
);

/** 排班表頁(`RosterCheckProvider`)內才拿得到。 */
export const useRosterCheck = (): RosterCheckContextValue => {
  const value = useContext(RosterCheckContext);
  if (value === null) {
    throw new Error("useRosterCheck 只能用在排班表頁(RosterCheckProvider)裡");
  }
  return value;
};

/** 檢核面板開著嗎(班表檢視據此把統計欄暫時收成 [統計 ▸];頁外 = false)。 */
export const useRosterCheckPanelOpen = (): boolean =>
  useContext(RosterCheckContext)?.isOpen === true;

/** [查看] 要捲到的格子:人的項目 `userId|date`、店的項目 `|date`。 */
export const checkTargetOf = (item: RosterCheckItem): RosterCellTarget =>
  typeof item.userId === "string"
    ? { userId: item.userId, date: item.date }
    : { date: item.date };
