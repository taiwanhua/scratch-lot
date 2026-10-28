import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { MenuItem } from "@repo/ui/menu";

import { useRosterCheck } from "../check-panel/roster-check-context";
import type { RosterToolbarActionProps } from "../roster-toolbar";

/**
 * 工具列的 [發布](規格 14.5;要 `schedule.manage.publish`,權限由工具列依登記過濾):
 * 已發布的月份不顯示(沒有取消發布)。點了打開發布確認視窗(`RosterPublishDialog`,由 `RosterCheckProvider` 畫,
 * 手機 [⋯] 選單關掉後照樣開著)。
 */
export const PublishAction = ({
  variant,
  onDone,
}: RosterToolbarActionProps) => {
  const t = useTranslations("admin.schedule.roster.publish");
  const { data, openPublish } = useRosterCheck();
  if (data === undefined || data.period.status === "published") {
    return null;
  }
  const open = () => {
    onDone();
    openPublish();
  };
  return variant === "menu" ? (
    <MenuItem onClick={open}>{t("button")}</MenuItem>
  ) : (
    <Button variant="contained" size="small" onClick={open}>
      {t("button")}
    </Button>
  );
};
