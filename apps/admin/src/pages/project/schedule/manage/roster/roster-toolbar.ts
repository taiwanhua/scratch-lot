import type { ComponentType } from "react";

import { CheckButton } from "./check-panel/CheckButton";
import { PublishAction } from "./publish/PublishAction";

/**
 * 排班表工具列的擴充點(規格 14.5 工具列:`[+ 人力需求] [+ 新增排班] [套用範本] [自動排班] [發布]`,
 * 第二列最右邊是檢核按鈕)。頁殼只放 [+ 人力需求] [+ 新增排班];其餘由各功能追加一列。
 */

/** 工具列按鈕的畫法:電腦 / 平板是工具列上的按鈕,手機收進 [⋯] 選單的一項。 */
export interface RosterToolbarActionProps {
  variant: "toolbar" | "menu";
  /** 手機選單點完要關掉選單 */
  onDone: () => void;
}

export interface RosterToolbarAction {
  /** 唯一 key(`apply-templates` = [套用範本]:這個月還沒有人力需求的畫面也放它) */
  key: string;
  /** 看得到這顆按鈕要的權限 */
  permission: string;
  Action: ComponentType<RosterToolbarActionProps>;
  /**
   * 手機的放法(規格 SC-55 / 56):`menu`(缺席時的預設)= 收進 [⋯] 選單;
   * `button` = 獨立一顆按鈕,放在 [⋯] 的右邊(例:[發布])。
   */
  mobile?: "button" | "menu";
}

/** [+ 新增排班] 之後的按鈕(依規格順序追加)。 */
export const ROSTER_TOOLBAR_ACTIONS: readonly RosterToolbarAction[] = [
  // [發布](已發布的月份不顯示;排在 [自動排班] 之後,自動排班的功能插在它前面)
  {
    key: "publish",
    permission: "schedule.manage.publish",
    Action: PublishAction,
    mobile: "button",
  },
];

/** 第二列最右邊(檢核按鈕)。 */
export const ROSTER_TOOLBAR_END: readonly ComponentType[] = [CheckButton];
