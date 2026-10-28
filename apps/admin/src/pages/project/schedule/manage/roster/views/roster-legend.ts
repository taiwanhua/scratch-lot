import type { ScheduleLegendItem } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";

/**
 * 排班表各檢視的圖例項目(規格 14.5「圖例」;各檢視的 `ScheduleLegend` 只讀這裡)。
 * 列的是該檢視**可能**出現的記號,不看當下資料(這週剛好沒有店休也照列)。檢視新增一種記號時同時加在這裡;
 * `RosterLegend.test.tsx` 渲染各檢視,畫面上找得到的記號都要在這裡。
 */
export const ROSTER_LEGEND_ITEMS = {
  /** 週(電腦 / 平板):時間軸長條、容器(「臨」)、缺額、延伸段、「+N」;日期旁 ⏲;特殊日底色、店休停用區 */
  week: [
    "leader",
    "entry",
    "temp",
    "auto",
    "multi",
    "breakMinutes",
    "special",
    "closed",
    "unmatchedPunch",
    "extension",
    "vacancyLeader",
    "vacancyHelper",
    "moreNeutral",
    "moreWarning",
    "moreError",
  ],
  /** 日(電腦 / 平板):同週,但重疊的容器往下排、沒有「+N」 */
  day: [
    "leader",
    "entry",
    "temp",
    "auto",
    "multi",
    "breakMinutes",
    "special",
    "closed",
    "unmatchedPunch",
    "extension",
    "vacancyLeader",
    "vacancyHelper",
  ],
  /** 日(手機):卡片(標題「臨」、右上人數標籤三色)、人、缺額;上方那天的店休 / 特殊日與 ⏲ */
  dayMobile: [
    "leader",
    "temp",
    "auto",
    "multi",
    "breakMinutes",
    "missingLeader",
    "missingHelper",
    "full",
    "special",
    "closed",
    "unmatchedPunch",
    "vacancyLeader",
    "vacancyHelper",
  ],
  /** 週(手機):7 天清單(人數標籤三色、「臨」)、特殊日底色、店休那一列、那天的 ⏲ */
  weekMobile: [
    "missingLeader",
    "missingHelper",
    "full",
    "temp",
    "special",
    "closed",
    "unmatchedPunch",
  ],
  /** 月(電腦 / 平板):標籤三色、「臨」、店休、特殊日、⏲ */
  month: [
    "full",
    "missingHelper",
    "missingLeader",
    "closed",
    "special",
    "unmatchedPunch",
    "temp",
  ],
  /** 月(手機):每筆人力需求一顆點、店休、特殊日、⏲ */
  monthMobile: [
    "dotFull",
    "dotMissingHelper",
    "dotMissingLeader",
    "closed",
    "special",
    "unmatchedPunch",
  ],
  /** 日檢視的選日期月曆:當天最嚴重的點、店休、特殊日 */
  dayPicker: ["dotMissingLeader", "dotMissingHelper", "closed", "special"],
  /**
   * 班表:人員格子(已排的班、負責人、「臨」、「晚 ×2」、自動排入、休息、畫休斜線、不可排灰塊、店休停用底色、
   * 時鐘圖示)、人力需求區的人數標籤三色、特殊日整欄底色
   */
  grid: [
    "leader",
    "entry",
    "temp",
    "auto",
    "multiText",
    "breakMinutes",
    "unavailable",
    "dayOff",
    "closed",
    "special",
    "missingHelper",
    "missingLeader",
    "full",
    "unmatchedPunch",
  ],
} as const satisfies Record<string, readonly ScheduleLegendItem[]>;
