import type { ComponentType } from "react";

import { AutoRunSummary } from "../auto-run/AutoRunSummary";

/**
 * 檢核面板最上方的擴充點(規格 14.5「檢核面板」:最上方是最近一次自動排班的摘要與 [清除自動排入的人])。
 * 由自動排班的功能追加一列;元件用 `useRosterCheck()` 拿資料。
 * (「未對應排班的打卡」是 api 檢核結果的一類,`ScheduleCheckItem.key`,不經這裡。)
 */
export const CHECK_PANEL_HEADER: readonly ComponentType[] = [AutoRunSummary];
