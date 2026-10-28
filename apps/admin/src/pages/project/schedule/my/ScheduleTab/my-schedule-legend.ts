import type { ScheduleLegendItem } from "@/components/project/schedule/ScheduleLegend/ScheduleLegend";

/**
 * 我的班表 → 班表分頁的圖例項目(規格 14.6;同 14.5「圖例」:列該檢視**可能**畫出的記號,不看當下資料;
 * 文字本身就說明的「店休」「負責 / 協同」「缺下班卡」「有異動」標籤不列)。檢視新增記號時同時加在這裡;
 * `MyScheduleLegend.test.tsx` 逐項對照畫面。
 */
export const MY_SCHEDULE_LEGEND_ITEMS = {
  /** 月曆(電腦 / 平板):簡稱(負責人綠底、「臨」= 沒有套用範本的班)、打卡時間、畫休斜線、缺卡紅點、有異動金點、特殊日底色 */
  calendar: [
    "leader",
    "tempEntry",
    "punchTimes",
    "dayOff",
    "missingDot",
    "changedDot",
    "special",
  ],
  /** 月曆(手機):只放簡稱,沒有打卡時間 */
  calendarMobile: [
    "leader",
    "tempEntry",
    "dayOff",
    "missingDot",
    "changedDot",
    "special",
  ],
  /** 條列:「臨」、打卡時間、休息、畫休斜線、特殊日底色 */
  list: ["tempEntry", "punchTimes", "breakMinutes", "dayOff", "special"],
} as const satisfies Record<string, readonly ScheduleLegendItem[]>;
