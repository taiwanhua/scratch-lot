import { createContext, useContext } from "react";

import type {
  ScheduleDemandFieldsFragment,
  ScheduleEntryFieldsFragment,
  ScheduleRosterQuery,
} from "@repo/graphql";

export type RosterData = ScheduleRosterQuery["scheduleRoster"];

/** 排班表查詢的快取 key 前綴(寫入後一律讓它失效;前綴比對涵蓋每家店、每個月)。 */
export const ROSTER_QUERY_ROOT = ["ScheduleRoster"];
export type RosterDemand = ScheduleDemandFieldsFragment;
export type RosterEntry = ScheduleEntryFieldsFragment;
export type RosterPerson = RosterData["people"][number];
export type RosterTemplate = RosterData["templates"][number];

/** 檢核 [查看] 等要捲到的格子:某人某天(班表檢視)/ 某天(其他檢視)。 */
export interface RosterCellTarget {
  date: string;
  userId?: string;
}

/** 新增人力需求時帶入的值(週 / 日 / 月檢視點空白處、班表人力需求區點空白格)。 */
export interface DemandPreset {
  date?: string;
  /** 帶入那一列範本的時間、崗位、執行任務 */
  templateId?: string | null;
  startTime?: string;
  endTime?: string;
}

/** 新增排班時帶入的值(班表點空白格 = 人員、日期;週 / 日點缺額 = 那筆人力需求與執行任務)。 */
export interface EntryPreset {
  date?: string;
  userId?: string;
  demandId?: string;
  taskId?: string;
}

/**
 * 排班表頁殼提供給各檢視(班表 / 月 / 週 / 日)與工具列功能的東西:同一份資料、同一套對話框、捲到格子。
 * 檢視只讀資料、呼叫這些動作;對話框由頁殼開。
 */
export interface RosterContextValue {
  data: RosterData;
  timezone: string;
  /** 能不能改(`canEdit`);沒有時空白處、缺額不能點,對話框唯讀 */
  canEdit: boolean;
  /** 打開人力需求對話框:給一筆 = 編輯(唯讀時看);給 preset = 新增 */
  openDemand: (target: RosterDemand | DemandPreset) => void;
  /** 打開排班對話框:給一筆 = 編輯(唯讀時看);給 preset = 新增 */
  openEntry: (target: RosterEntry | EntryPreset) => void;
  /** 日期欄 [⋯] → 移除這天所有排班 */
  removeDay: (date: string) => void;
  /**
   * 捲到那一格並閃爍(檢核面板 [查看] 用)。頁殼切到目標的月份、等格子畫出來再捲;
   * **各檢視自己負責把目標帶進畫面**(週 / 日檢視依 `scrollTarget` 切到那一週 / 那一天),
   * 而且每個檢視的格子都要帶 `data-roster-cell={rosterCellKey(...)}`:**有人的格子一律帶 `userId|date`**
   * (班表的人員格、週 / 日的長條),只有日期的格子帶 `|date`(月檢視的日期格、日期表頭)。
   * 找不到 `userId|date` 時頁殼改找那一天的 `|date`。
   */
  scrollToCell: (target: RosterCellTarget) => void;
  /** 等著被捲到的格子(最多留 10 秒,之後回 null);週 / 日檢視據此切到那一週 / 那一天 */
  scrollTarget: RosterCellTarget | null;
}

export const RosterContext = createContext<RosterContextValue | null>(null);

/** 排班表頁殼內才拿得到。 */
export const useRoster = (): RosterContextValue => {
  const value = useContext(RosterContext);
  if (value === null) {
    throw new Error("useRoster 只能用在排班表頁殼(RosterPage)裡");
  }
  return value;
};

/** 格子的定位鍵(`data-roster-cell`;`scrollToCell` 依它找元素)。 */
export const rosterCellKey = (target: RosterCellTarget): string =>
  `${target.userId ?? ""}|${target.date}`;

export const isDemand = (
  target: RosterDemand | DemandPreset,
): target is RosterDemand => "id" in target && "tasks" in target;

export const isEntry = (
  target: RosterEntry | EntryPreset,
): target is RosterEntry => "id" in target && "assignments" in target;
