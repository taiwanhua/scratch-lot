import type { ScheduleTabEntry } from "@/components/project/schedule/ScheduleTabsPage/ScheduleTabsPage";

import { ByPersonTab } from "./ByPersonTab";
import { ByStoreTab } from "./ByStoreTab";

/**
 * 出勤紀錄(`schedule.attendance`,表單模組:綁定 補打卡申請)的分頁
 * (規格 14.7:依人員(月)/ 依分店(日))。頁殼先建好,各分頁由負責的功能追加一列。
 * 兩頁都是列表分頁(`isList`,STYLE-08):平板以上且視窗夠高時表格在卡片裡捲、表頭固定。
 */
export const ATTENDANCE_TABS: readonly ScheduleTabEntry[] = [
  // 依人員(月):員工只看自己的;`view-all` 可以選人(SC-11)
  {
    value: "person",
    labelKey: "attendanceByPerson",
    isList: true,
    Content: ByPersonTab,
  },
  // 依分店(日):已到 / 未到、遲到 / 早退、未對應排班的打卡(SC-12)
  {
    value: "store",
    labelKey: "attendanceByStore",
    isList: true,
    Content: ByStoreTab,
  },
];
