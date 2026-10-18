import type { ReactNode } from "react";

import type { TagTone } from "../Tag/tag-tones";

/** 一個日期欄。欄位 key 就是 `date`(欄位顯示狀態也用它)。 */
export interface RosterDate {
  /** `YYYY-MM-DD` */
  date: string;
  /** 表頭內容(例:「10/13」+「二 · 公休」),由使用的模組決定 */
  header: ReactNode;
  /** 不能操作的日子(例:公休):整欄停用色、格子不能點 */
  disabled?: boolean;
}

/** 日期格的渲染參數。 */
export interface RosterCellContext<Person> {
  person: Person;
  date: string;
  /** 人員列的顯示順序 */
  index: number;
}

/** 選取中的格子。 */
export interface RosterCellKey {
  personKey: string;
  date: string;
}

/** 可以收合成一個窄欄的一組欄位(例:[統計 ▸])。 */
export interface RosterColumnGroup {
  id: string;
  /** 收合按鈕的文字(例:「統計」) */
  label: string;
  /** 屬於這組的欄位 key(在 `leadingColumns` / `trailingColumns` 裡) */
  columnKeys: readonly string[];
}

/** 頂部固定群組的一列(例:一種時段需求範本)。 */
export interface RosterTopGroupRow {
  key: string;
  /** 左側人員欄位置顯示的列名 */
  label: ReactNode;
  /** 每天一格的內容(例:狀態標籤),key 是 `YYYY-MM-DD`;沒有的就是空白格 */
  cells: Readonly<Partial<Record<string, ReactNode>>>;
}

/** 收合時每天一格的彙總:主行 + 副行,顏色由使用的模組決定。 */
export interface RosterTopGroupSummary {
  primary: ReactNode;
  secondary?: ReactNode;
  /** 色調(同 `Tag`);預設 grey */
  tone?: TagTone;
}

/**
 * 頂部固定群組:日期表頭下方、人員列上方的一組列,和表頭、左右固定欄一起固定。
 * 收合狀態由使用的模組保存(受控)。
 */
export interface RosterTopGroup {
  /** 群組標題(例:「時段需求」) */
  title: ReactNode;
  rows: readonly RosterTopGroupRow[];
  /** 收合時的每日彙總,key 是 `YYYY-MM-DD` */
  summary: Readonly<Partial<Record<string, RosterTopGroupSummary>>>;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** 空白格滑過時的淡色提示(例:「+ 時段需求」);沒給就不顯示 */
  emptyCellHint?: string;
  /** 點空白格:帶日期與那一列的 key;沒給時空白格不可點 */
  onEmptyCellClick?: (date: string, rowKey: string) => void;
}
