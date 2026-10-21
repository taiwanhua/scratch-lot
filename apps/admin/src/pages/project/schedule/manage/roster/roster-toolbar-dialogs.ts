import type { ComponentType } from "react";

import { ApplyTemplatesDialog } from "./auto-run/ApplyTemplatesDialog";
import { AutoRunDialog } from "./auto-run/AutoRunDialog";
import {
  APPLY_TEMPLATES_DIALOG,
  AUTO_RUN_DIALOG,
} from "./auto-run/ToolbarActions";

/**
 * 工具列功能打開的對話框 / 抽屜(`useRosterCheck().openDialog(key)`):由 `RosterCheckProvider` 畫,
 * 不畫在按鈕裡 —— 手機時按鈕在 [⋯] 底部選單裡,選單一關按鈕就卸載。各功能追加一列。
 * 對話框畫在排班表內容(`RosterContext`)外面:要資料用 `useRosterCheck()`。
 */
export interface RosterToolbarDialogEntry {
  key: string;
  Dialog: ComponentType<{ onClose: () => void }>;
}

export const ROSTER_TOOLBAR_DIALOGS: readonly RosterToolbarDialogEntry[] = [
  // [套用範本] 右側抽屜(手機全螢幕)、[自動排班] 對話框(規格 14.4、14.5)
  { key: APPLY_TEMPLATES_DIALOG, Dialog: ApplyTemplatesDialog },
  { key: AUTO_RUN_DIALOG, Dialog: AutoRunDialog },
];
